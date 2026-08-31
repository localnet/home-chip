// Import the SDK isolation side effect before any "@matter/main" import (see sdk-config.ts).
import "../sdk-config.ts";

import { InternalError, ValidationError } from "@home-chip/contract/common/errors.ts";
import { createEndpointId, createNodeId, type NodeId } from "@home-chip/contract/common/ids.ts";
import type { EndpointRecord } from "@home-chip/contract/endpoint/types.ts";
import type { DomainEventBus } from "@home-chip/contract/events.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import {
    CommissioningFailedError,
    DecommissioningFailedError,
    DeviceAlreadyCommissionedError,
    NodeAsleepError,
    NodeNotFoundError,
    NodeOfflineError,
    SetupCodeAmbiguousError,
} from "@home-chip/contract/node/errors.ts";
import type { NodeGateway } from "@home-chip/contract/node/ports.ts";
import type { CommissioningResult, NodeInfo } from "@home-chip/contract/node/types.ts";
import { NoResponseTimeoutError, type ObserverGroup } from "@matter/main";
import { BasicInformationClient } from "@matter/main/behaviors/basic-information";
import { type ClientNode, IcdPeerAsleepError, type ServerNode } from "@matter/main/node";
import { DeviceAlreadyCommissionedToThisFabricError, TransientPeerCommunicationError } from "@matter/main/protocol";
import { type QrCodeData, QrPairingCodeCodec } from "@matter/main/types";

import type { IdentityMap, NodeIdentity } from "../identity.ts";
import { NodeWatcher } from "../watcher.ts";

/**
 * Trims a value and returns it only if non-empty, so a whitespace-only or empty label
 * falls through the default-name chain instead of winning as a blank name.
 */
const nonEmpty = (value: string | undefined): string | undefined => value?.trim() || undefined;

/** The prefix a QR onboarding payload carries, per Core § 5.1.3.1. */
const QR_PREFIX = "MT:";

/**
 * Implements the NodeGateway port against the Matter SDK, translating between our NodeId and the
 * SDK's ClientNode through the shared IdentityMap and emitting node lifecycle events on the bus.
 *
 * `commission` neither persists nor announces: it returns a CommissioningResult, and the
 * commissioning use-case owns the transaction and the events.
 */
export class SdkNodeGateway implements NodeGateway {
    readonly #logger: Logger;
    readonly #bus: DomainEventBus;
    readonly #identity: IdentityMap;
    readonly #controller: ServerNode;
    readonly #watcher: NodeWatcher;

    constructor(logger: Logger, bus: DomainEventBus, identity: IdentityMap, controller: ServerNode) {
        this.#logger = logger;
        this.#bus = bus;
        this.#identity = identity;
        this.#controller = controller;
        this.#watcher = new NodeWatcher(identity, (group, node) => this.#watchLifecycle(group, node));
    }

    /**
     * Begins emitting node lifecycle events for every node the IdentityMap holds now or gains
     * later. The observer bookkeeping — including releasing a decommissioned node's observers —
     * lives in NodeWatcher, shared with the endpoint gateway.
     */
    start(): void {
        this.#watcher.start();
    }

    /** Stops emitting lifecycle events and detaches every observer it attached. */
    stop(): void {
        this.#watcher.stop();
    }

    async commission(setupCode: string): Promise<CommissioningResult> {
        const options = this.#commissioningOptions(setupCode);
        let node: ClientNode;
        try {
            node = await this.#controller.peers.commission(options);
        } catch (error) {
            // The device answered the AddNOC step with a FabricConflict: it already holds our
            // fabric. Typically one dropped with decommission(force), which forgets it here but
            // leaves our credentials on the device; a factory reset clears them.
            if (error instanceof DeviceAlreadyCommissionedToThisFabricError) {
                throw new DeviceAlreadyCommissionedError();
            }
            throw new CommissioningFailedError(error);
        }

        const nodeId = createNodeId();
        const matterId = this.#requireMatterId(node);
        const endpoints = this.#composeEndpoints(nodeId, node);

        // Register identity with the endpoints in hand, so the endpoint gateway can begin
        // watching them without waiting for the use-case to persist.
        this.#identity.addNode({
            nodeId,
            node,
            endpoints: endpoints.map((record) => ({
                endpointId: record.id,
                endpointNumber: record.matterNumber,
            })),
        });
        this.#logger.info("commissioned node to the fabric", nodeId, endpoints.length);

        return {
            node: { id: nodeId, matterId },
            endpoints,
        };
    }

    async decommission(nodeId: NodeId, force = false): Promise<void> {
        const node = this.#requireNode(nodeId);
        try {
            // force goes straight to the SDK's local delete: attempting the fabric removal
            // first would reintroduce the very wait (an asleep LIT holds the interaction until
            // it wakes) that force exists to escape. The device keeps our fabric credentials
            // and needs a factory reset before it can be commissioned again.
            await (force ? node.delete() : node.decommission());
        } catch (error) {
            // The two unreachable cases first, both meaning the removal never reached the device:
            // an asleep LIT ICD the SDK gave up holding, and a peer that did not answer or whose
            // channel broke. Anything else is a decommissioning that failed for its own reasons.
            if (error instanceof IcdPeerAsleepError) {
                throw new NodeAsleepError(nodeId, error);
            }
            if (error instanceof NoResponseTimeoutError || error instanceof TransientPeerCommunicationError) {
                throw new NodeOfflineError(nodeId, error);
            }
            throw new DecommissioningFailedError(nodeId, error);
        }
        this.#identity.removeNode(nodeId);
        // Forced or not is the whole difference for whoever reads this later: a forced removal
        // leaves our fabric credentials on the device, so it needs a factory reset before it can
        // be commissioned again.
        this.#logger.info("decommissioned node", nodeId, force ? "forced" : "from the fabric");
    }

    isReachable(nodeId: NodeId): boolean {
        // Read from the IdentityMap (in-memory) rather than #requireNode: an unknown or
        // unmapped node is not reachable, not an error — see the NodeGateway contract.
        return this.#identity.getNode(nodeId)?.lifecycle.isOnline ?? false;
    }

    getInfo(nodeId: NodeId): NodeInfo {
        const node = this.#requireNode(nodeId);
        // Basic Information is a fixed, well-known cluster, so we read it through the typed
        // behavior (cached, named fields) rather than the numeric interaction model the
        // endpoint gateway uses for arbitrary attributes.
        const basic = node.stateOf(BasicInformationClient);
        return {
            id: nodeId,
            matterId: `0x${this.#requireMatterId(node).toString(16)}`,
            commissionedAt: node.state.commissioning.commissionedAt ?? null,
            label: basic.nodeLabel ?? "",
            vendorName: basic.vendorName,
            productName: basic.productName,
            vendorId: basic.vendorId,
            productId: basic.productId,
            hardwareVersion: basic.hardwareVersion,
            softwareVersion: basic.softwareVersion,
            softwareVersionString: basic.softwareVersionString,
        };
    }

    /**
     * Turns a setup code into the SDK's commissioning options. The manual pairing code goes
     * through as `pairingCode`, which is the only form the SDK decodes for us; a QR payload has
     * to be decoded here, since `pairingCode` runs it through the manual codec and fails.
     *
     * A QR payload may carry several devices concatenated, one per product. Nothing in it says
     * which to pair, so it is refused rather than paired with whichever answers first.
     */
    #commissioningOptions(setupCode: string): { pairingCode: string } | { passcode: number; discriminator: number } {
        if (!setupCode.startsWith(QR_PREFIX)) {
            return { pairingCode: setupCode };
        }
        let payloads: QrCodeData[];
        try {
            payloads = QrPairingCodeCodec.decode(setupCode);
        } catch (error) {
            // Nothing has been contacted yet: the code itself is wrong, past the shape the schema
            // could check — a bad Base38 body, a reserved version, a passcode the spec excludes.
            throw new ValidationError("Setup code is not a readable QR payload", {
                cause: error,
                data: { setupCode },
            });
        }
        // A decode that succeeds yields at least one payload, so the undefined case is
        // unreachable; it is checked because the index signature is otherwise optional.
        const payload = payloads[0];
        if (payload === undefined || payloads.length > 1) {
            throw new SetupCodeAmbiguousError(payloads.length);
        }
        return { passcode: payload.passcode, discriminator: payload.discriminator };
    }

    #requireNode(nodeId: NodeId): ClientNode {
        const node = this.#identity.getNode(nodeId);
        if (node === undefined) {
            throw new NodeNotFoundError(nodeId);
        }
        return node;
    }

    /**
     * The Matter uint64 node id lives in the peer address. It is always present for a
     * commissioned node; its absence would be a broken SDK invariant, not an expected
     * case, so we fail loudly rather than fabricate a value.
     */
    #requireMatterId(node: ClientNode): bigint {
        const peerAddress = node.state.commissioning.peerAddress;
        if (peerAddress === undefined) {
            throw new InternalError("Commissioned node has no peer address");
        }
        return peerAddress.nodeId;
    }

    #composeEndpoints(nodeId: NodeId, node: ClientNode): EndpointRecord[] {
        const name = this.#defaultName(node);
        const records: EndpointRecord[] = [];
        // `endpoints` and not `parts`: parts holds a node's direct children, so a bridge's
        // devices — which hang off its aggregator endpoint — would be missed entirely. endpoints
        // is the flat index of the whole tree, and includes the root, which is what the guard
        // below is for.
        for (const endpoint of node.endpoints) {
            // Endpoint 0 is the root, carrying only utility and administration clusters:
            // Descriptor, Basic Information, commissioning, credentials. Nothing to control and
            // nothing to render, so it is never registered as a domain endpoint and a client can
            // neither address nor invoke those clusters. Node-level data is served by getInfo.
            if (endpoint.number === 0) {
                continue;
            }
            records.push({
                id: createEndpointId(),
                nodeId,
                matterNumber: endpoint.number,
                name,
                roomId: null,
            });
        }
        return records;
    }

    /**
     * Derives a default, non-empty name for the node's endpoints from its Basic
     * Information: the user/manufacturer-set NodeLabel first, then the generic ProductName,
     * then a constant last resort for a device that populates neither (a spec violation).
     * All of a node's endpoints share this name; the user disambiguates the rare
     * multi-endpoint device by renaming, which is the only reliable mapping to a physical
     * unit. Per-endpoint naming (bridged device labels, composed-device labels) is added
     * when those cases are supported — as a step prepended to this chain.
     */
    #defaultName(node: ClientNode): string {
        const basic = node.stateOf(BasicInformationClient);
        return nonEmpty(basic.nodeLabel) ?? nonEmpty(basic.productName) ?? "Matter Device";
    }

    /**
     * Emits node:connected / node:disconnected from the node's own lifecycle transitions.
     * Registered on the group NodeWatcher owns for this node, so both observers are detached
     * together when the node is decommissioned or the gateway stops.
     */
    #watchLifecycle(group: ObserverGroup, identity: NodeIdentity): void {
        const nodeId = identity.nodeId;
        group.on(identity.node.lifecycle.online, () => {
            this.#bus.emit("node:connected", { nodeId, timestamp: Date.now() });
        });
        group.on(identity.node.lifecycle.offline, () => {
            this.#bus.emit("node:disconnected", { nodeId, timestamp: Date.now() });
        });
    }
}
