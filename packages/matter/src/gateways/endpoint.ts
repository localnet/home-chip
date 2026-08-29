// Import the SDK isolation side effect before any "@matter/main" import (see sdk-config.ts).
import "../sdk-config.ts";

import { type AppError, ValidationError } from "@home-chip/contract/common/errors.ts";
import type { EndpointId } from "@home-chip/contract/common/ids.ts";
import {
    AttributeNotFoundError,
    CommandNotFoundError,
    CommandRejectedError,
    EndpointAsleepError,
    EndpointNotFoundError,
    EndpointOfflineError,
    InteractionFailedError,
    WriteRejectedError,
} from "@home-chip/contract/endpoint/errors.ts";
import type { EndpointGateway } from "@home-chip/contract/endpoint/ports.ts";
import type {
    AttributeState,
    AttributeValue,
    ClusterState,
    EndpointShape,
} from "@home-chip/contract/endpoint/types.ts";
import type { DomainEventBus } from "@home-chip/contract/events.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import { NoResponseTimeoutError, type Observable, type ObserverGroup } from "@matter/main";
import { type ClientNode, type Endpoint, IcdPeerAsleepError } from "@matter/main/node";
import { Invoke, Read, TransientPeerCommunicationError, Write } from "@matter/main/protocol";
import { AttributeId, ClusterId, EndpointNumber, Status } from "@matter/main/types";

import { clusterModel } from "../clusters.ts";
import type { IdentityMap, NodeIdentity } from "../identity.ts";
import { NodeWatcher } from "../watcher.ts";

/** The runtime shape of a supported behavior's cluster model that watch() navigates. */
interface ClusterBehavior {
    readonly cluster?: {
        readonly id?: number;
        readonly attributes: Record<string, { readonly id: number }>;
    };
}

/**
 * A per-attribute change observable, as found on an endpoint's events under
 * `<attribute>$Changed`. The SDK's event maps are typed as generic records, so this names the
 * runtime shape we navigate to; it is an SDK Observable, which is what ObserverGroup registers.
 */
type ChangeObservable = Observable<[value: unknown]>;

/**
 * Maps an error out of an SDK interaction to the contract's vocabulary, shared by read, write and
 * invoke because all three fail the same way.
 *
 * The two unreachable cases come first, both meaning the request never arrived, which is what
 * makes them retryable: the SDK holds an interaction for an asleep LIT ICD and gives up with
 * IcdPeerAsleepError, and reports an unresponsive or dropped peer through the timeout and
 * transient-communication families. Anything else is a failure of the interaction itself, about
 * which nothing further is asserted.
 *
 * The callers wrap only the SDK call, resolution and model lookups happening before it, so no
 * domain error can arrive here to be mapped a second time.
 */
function interactionError(error: unknown, endpointId: EndpointId, clusterId: number): AppError {
    if (error instanceof IcdPeerAsleepError) {
        return new EndpointAsleepError(endpointId, clusterId, error);
    }
    if (error instanceof NoResponseTimeoutError || error instanceof TransientPeerCommunicationError) {
        return new EndpointOfflineError(endpointId, clusterId, error);
    }
    return new InteractionFailedError(endpointId, clusterId, error);
}

/**
 * Drains an invoke response into the statuses it reported. The SDK streams a response as chunks
 * of results, so collecting first keeps the throw for a refused command out of the iteration,
 * where it would otherwise have to be caught and rethrown to get past the error mapping below.
 *
 * A write needs none of this — it answers with an array — and a read cannot use it either: it
 * must stop at the first value rather than drain, and each entry carries a value where these
 * carry only a status.
 */
async function collectStatuses(
    response: AsyncIterable<Iterable<{ kind: string; status?: Status }>>,
): Promise<number[]> {
    const statuses: number[] = [];
    for await (const chunk of response) {
        for (const result of chunk) {
            if (result.kind === "cmd-status" && result.status !== undefined) {
                statuses.push(result.status);
            }
        }
    }
    return statuses;
}

/**
 * Implements the EndpointGateway port against the SDK's interaction model, on the numeric
 * identifiers the contract uses. A read passes them straight through as an attribute path; a
 * write and an invoke resolve them through the cluster model (see clusters.ts), the SDK encoding
 * the value or the command fields against the element's schema.
 *
 * Endpoint identity is translated in memory by the IdentityMap, so read, write and invoke never
 * block on storage. Attribute watching hangs off the map's own notifications rather than the
 * domain bus: a node's endpoints become watchable the moment commissioning registers them.
 */
export class SdkEndpointGateway implements EndpointGateway {
    readonly #logger: Logger;
    readonly #bus: DomainEventBus;
    readonly #identity: IdentityMap;
    readonly #watcher: NodeWatcher;

    constructor(logger: Logger, bus: DomainEventBus, identity: IdentityMap) {
        this.#logger = logger;
        this.#bus = bus;
        this.#identity = identity;
        this.#watcher = new NodeWatcher(identity, (group, node) => this.#watchEndpoints(group, node));
    }

    /**
     * Begins observing attribute changes on every node the IdentityMap holds now or gains
     * later. The observer bookkeeping — including releasing a decommissioned node's observers —
     * lives in NodeWatcher, shared with the node gateway.
     */
    start(): void {
        this.#watcher.start();
    }

    /** Stops observing and detaches every observer it attached. */
    stop(): void {
        this.#watcher.stop();
    }

    async read(endpointId: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue> {
        const { node, endpointNumber } = this.#resolve(endpointId);

        let request: Read;
        try {
            request = Read({
                attributes: [
                    {
                        endpointId: EndpointNumber(endpointNumber),
                        clusterId: ClusterId(clusterId),
                        attributeId: AttributeId(attributeId),
                    },
                ],
            });
        } catch (error) {
            // Not addressable in Matter at all: an id is valid only as a global attribute or with an
            // MEI type suffix up to 0x4fff, which is narrower than the range our schema accepts.
            // Nothing was contacted, so this is the parameter being wrong rather than the element
            // being absent — write and invoke never reach here, their model lookup rejecting the
            // same ids first.
            throw new ValidationError("Cluster or attribute id is not addressable in Matter", {
                cause: error,
                data: { endpointId, clusterId, attributeId },
            });
        }

        try {
            for await (const chunk of node.interaction.read(request)) {
                // A chunk may be a sync or async iterable of reports; for-await handles both.
                for await (const entry of chunk) {
                    if (entry.kind === "attr-value") {
                        return entry.value as AttributeValue;
                    }
                    if (entry.kind === "attr-status") {
                        // The device answered but the attribute path is not served.
                        throw new AttributeNotFoundError(endpointId, clusterId, attributeId);
                    }
                }
            }
        } catch (error) {
            if (error instanceof AttributeNotFoundError) {
                throw error;
            }
            throw interactionError(error, endpointId, clusterId);
        }
        // The interaction completed normally yet yielded neither value nor status: the path
        // matched nothing on the device. Not a failure of the interaction, so it belongs here
        // rather than inside the try, where it would round-trip through our own catch.
        throw new AttributeNotFoundError(endpointId, clusterId, attributeId);
    }

    async write(endpointId: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void> {
        const { node, endpointNumber } = this.#resolve(endpointId);

        // Unlike read, which takes a numeric path, a write addresses the attribute by name
        // against the cluster descriptor: the SDK encodes the value to the attribute's schema.
        // An id the Matter model does not know is refused before the device is contacted.
        const entry = clusterModel.get(clusterId);
        const attribute = entry?.attributeNames.get(attributeId);
        if (entry === undefined || attribute === undefined) {
            throw new AttributeNotFoundError(endpointId, clusterId, attributeId);
        }

        const request = Write(
            Write.Attribute({
                endpoint: EndpointNumber(endpointNumber),
                cluster: entry.cluster as Parameters<typeof Write.Attribute>[0]["cluster"],
                attributes: attribute,
                value,
            }),
        );

        let statuses: { status: Status }[];
        try {
            statuses = await node.interaction.write(request);
        } catch (error) {
            throw interactionError(error, endpointId, clusterId);
        }

        for (const { status } of statuses) {
            // The device answered and refused: an unsupported write, a value out of range, a
            // missing privilege. The IM status is what tells the client which.
            if (status !== Status.Success) {
                throw new WriteRejectedError(endpointId, clusterId, attributeId, status);
            }
        }
    }

    async invoke(endpointId: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void> {
        const { node, endpointNumber } = this.#resolve(endpointId);

        const entry = clusterModel.get(clusterId);
        const command = entry?.commandNames.get(commandId);
        if (entry === undefined || command === undefined) {
            // The command is unknown to the Matter model - reject before contacting the device.
            throw new CommandNotFoundError(endpointId, clusterId, commandId);
        }

        // A command with no fields is invoked with args omitted (undefined), which is what
        // the SDK expects as void; commands that take fields receive them as-is (and the SDK
        // rejects a missing required field with its own validation error).
        const request = Invoke({
            commands: [{ endpoint: EndpointNumber(endpointNumber), cluster: entry.cluster, command, fields: args }],
        });

        let statuses: number[];
        try {
            statuses = await collectStatuses(node.interaction.invoke(request));
        } catch (error) {
            throw interactionError(error, endpointId, clusterId);
        }

        for (const status of statuses) {
            if (status !== Status.Success) {
                throw new CommandRejectedError(endpointId, clusterId, commandId, status);
            }
        }
    }

    /**
     * Assembles the endpoint's structural shape from the SDK's materialized ClientNode:
     * its primary application device type plus the current state of every cluster it
     * serves. Reads entirely from the SDK's cached state (no device round-trip), so it
     * answers even when the node is offline — see the EndpointGateway contract.
     */
    describe(endpointId: EndpointId): EndpointShape {
        const { node, endpointNumber } = this.#resolve(endpointId);
        // `endpoints` and not `parts`: parts holds only a node's direct children, so an endpoint
        // nested under a bridge's aggregator would read as absent.
        if (!node.endpoints.has(endpointNumber)) {
            // Resolved in the IdentityMap but absent from the SDK structure: fabric and identity
            // have diverged.
            throw new EndpointNotFoundError(endpointId);
        }
        const endpoint = node.endpoints.for(endpointNumber);
        return {
            deviceType: endpoint.type.deviceType,
            clusters: this.#clustersOf(endpoint),
        };
    }

    /**
     * The current state of every cluster on the endpoint. Iterates the supported behaviors
     * (the same navigation #watchAttributes uses): for each, the cluster's declared
     * attributes with their cached values, and the device's AcceptedCommandList. The
     * cluster's global/meta attributes (featureMap, attributeList, …) are intentionally
     * excluded — the schema's `attributes` lists only the real cluster attributes.
     */
    #clustersOf(endpoint: Endpoint): ClusterState[] {
        const supported = endpoint.behaviors.supported as Record<string, ClusterBehavior>;
        const allState = endpoint.state as Record<string, Record<string, unknown> | undefined>;
        const clusters: ClusterState[] = [];

        for (const [behaviorName, behaviorType] of Object.entries(supported)) {
            const cluster = behaviorType.cluster;
            if (cluster?.id === undefined) {
                continue;
            }
            const state = allState[behaviorName] ?? {};
            const attributes: AttributeState[] = [];
            for (const [attributeName, attribute] of Object.entries(cluster.attributes)) {
                const value = state[attributeName];
                // Skip an attribute the schema lists but the device did not report a value
                // for: AttributeValue has no `undefined`, and null would be fabricated.
                if (value === undefined) {
                    continue;
                }
                attributes.push({ id: attribute.id, value: value as AttributeValue });
            }
            clusters.push({ id: cluster.id, attributes, acceptedCommands: this.#acceptedCommandsOf(state) });
        }
        return clusters;
    }

    /**
     * The device's AcceptedCommandList (global attribute 0xFFF9) as plain numeric command
     * ids, carried in the cluster's cached state. Empty when the cluster accepts no
     * commands (e.g. Descriptor).
     */
    #acceptedCommandsOf(state: Record<string, unknown>): number[] {
        const accepted = state.acceptedCommandList;
        return Array.isArray(accepted) ? (accepted as number[]) : [];
    }

    /**
     * Watches every endpoint of a node. Registered on the group NodeWatcher owns for that node,
     * so all of its observers are detached together when the node goes away.
     */
    #watchEndpoints(group: ObserverGroup, identity: NodeIdentity): void {
        for (const { endpointId, endpointNumber } of identity.endpoints) {
            if (!identity.node.endpoints.has(endpointNumber)) {
                // The node is mapped but the SDK has no endpoint with that number: fabric and
                // identity have diverged.
                this.#logger.warn("node has no Matter endpoint for record", endpointId);
                continue;
            }
            this.#watchAttributes(group, endpointId, identity.node.endpoints.for(endpointNumber));
        }
    }

    /**
     * Watches every attribute of every cluster on one endpoint, emitting `endpoint:changed`
     * whenever one changes. The numeric clusterId and attributeId the event carries come from
     * the SDK's own cluster model on the behavior (cluster.id and attribute.id), so the event
     * speaks the contract's numeric identifiers.
     */
    #watchAttributes(group: ObserverGroup, endpointId: EndpointId, endpoint: Endpoint): void {
        // The SDK's behavior and event maps are statically typed as generic records, so we
        // describe the runtime shape we navigate: each supported behavior carries a cluster
        // model (numeric id + named attributes), and per-attribute change observables live on
        // the endpoint's events under `<attribute>$Changed`. Observers are registered through
        // the owning node's group so they can all be detached when that node goes away.
        const supported = endpoint.behaviors.supported as Record<string, ClusterBehavior>;
        const allEvents = endpoint.events as Record<string, Record<string, ChangeObservable | undefined> | undefined>;

        for (const [behaviorName, behaviorType] of Object.entries(supported)) {
            const cluster = behaviorType.cluster;
            if (cluster?.id === undefined) {
                continue;
            }
            const clusterId = cluster.id;
            const events = allEvents[behaviorName];
            for (const [attributeName, attribute] of Object.entries(cluster.attributes)) {
                const attributeId = attribute.id;
                const observable = events?.[`${attributeName}$Changed`];
                if (typeof observable?.on !== "function") {
                    continue;
                }
                group.on(observable, (value) => {
                    this.#bus.emit("endpoint:changed", {
                        endpointId,
                        clusterId,
                        attributeId,
                        value: value as AttributeValue,
                        timestamp: Date.now(),
                    });
                });
            }
        }
    }

    /**
     * Resolves our EndpointId to the SDK ClientNode and matter endpoint number via the
     * in-memory IdentityMap. Throws EndpointNotFoundError if the endpoint is unknown or its
     * node is not currently mapped.
     */
    #resolve(endpointId: EndpointId): { node: ClientNode; endpointNumber: number } {
        const resolved = this.#identity.resolveEndpoint(endpointId);
        if (resolved === undefined) {
            throw new EndpointNotFoundError(endpointId);
        }
        return resolved;
    }
}
