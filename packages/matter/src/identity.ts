// Import the SDK isolation side effect before any "@matter/main" import (see sdk-config.ts).
import "./sdk-config.ts";

import type { Unsubscribe } from "@home-chip/contract/common/bus.ts";
import { InternalError } from "@home-chip/contract/common/errors.ts";
import type { EndpointId, NodeId } from "@home-chip/contract/common/ids.ts";
import type { ClientNode } from "@matter/main/node";

/**
 * The endpoint half of an identity entry: our EndpointId paired with the Matter endpoint
 * number it lives at on the node.
 */
export interface EndpointIdentity {
    readonly endpointId: EndpointId;
    readonly endpointNumber: number;
}

/** A node and its endpoints, as added to the map in one commissioning (or hydration) step. */
export interface NodeIdentity {
    readonly nodeId: NodeId;
    readonly node: ClientNode;
    readonly endpoints: readonly EndpointIdentity[];
}

/** The resolution of an EndpointId to the SDK node and endpoint number it addresses. */
export interface ResolvedEndpoint {
    readonly node: ClientNode;
    readonly endpointNumber: number;
}

type AddedListener = (identity: NodeIdentity) => void;
type RemovedListener = (nodeId: NodeId) => void;

/**
 * The single translation point between the SDK's identifiers and the domain's. Outside this
 * package only NodeId and EndpointId are ever seen; ClientNode and numeric endpoint addresses
 * never cross the boundary.
 *
 * A derived index, not a second source of truth: everything in it is recoverable from the SDK's
 * peers and the persisted records. It is rebuilt at start by correlating each persisted node with
 * the peer of the same matterId, and mutated only by commissioning and decommissioning, the same
 * routes that mutate the database, so it cannot drift from it. What it buys is the reverse lookup
 * neither store offers — from our ids to the live ClientNode and endpoint number — which keeps
 * read and invoke off the database. The ClientNode it holds is borrowed; the SDK keeps that
 * object alive in controller.peers.
 *
 * Additions and removals notify listeners, so the gateways can start and stop watching a node
 * without going through the domain event bus: translating ids is this package's own business,
 * not something the rest of the hub reacts to.
 */
export class IdentityMap {
    readonly #nodes = new Map<NodeId, ClientNode>();
    readonly #endpoints = new Map<EndpointId, ResolvedEndpoint>();
    readonly #nodeEndpoints = new Map<NodeId, EndpointId[]>();
    readonly #addedListeners = new Set<AddedListener>();
    readonly #removedListeners = new Set<RemovedListener>();

    /**
     * Adds a node and its endpoints, then notifies. The notification carries everything a
     * listener needs, so reacting to it never has to consult the database — which matters at
     * commissioning, where the endpoints are not persisted yet.
     *
     * A node id may be added only once. Overwriting would strand the previous endpoint ids:
     * `#nodeEndpoints` would be replaced, `removeNode` could no longer find them, and
     * `resolveEndpoint` would keep answering for them with a node we no longer control. Neither
     * caller can produce a duplicate — hydration walks unique rows, commissioning mints a fresh
     * id — so one arriving means an invariant broke, and failing loudly beats a corrupt index.
     */
    addNode(identity: NodeIdentity): void {
        if (this.#nodes.has(identity.nodeId)) {
            throw new InternalError(`Node ${identity.nodeId} is already in the identity map`);
        }
        this.#nodes.set(identity.nodeId, identity.node);
        const endpointIds: EndpointId[] = [];
        for (const endpoint of identity.endpoints) {
            this.#endpoints.set(endpoint.endpointId, {
                node: identity.node,
                endpointNumber: endpoint.endpointNumber,
            });
            endpointIds.push(endpoint.endpointId);
        }
        this.#nodeEndpoints.set(identity.nodeId, endpointIds);
        for (const listener of this.#addedListeners) {
            listener(identity);
        }
    }

    /** Removes a node and all its endpoints, then notifies removed-listeners. */
    removeNode(nodeId: NodeId): void {
        for (const endpointId of this.#nodeEndpoints.get(nodeId) ?? []) {
            this.#endpoints.delete(endpointId);
        }
        this.#nodeEndpoints.delete(nodeId);
        this.#nodes.delete(nodeId);
        for (const listener of this.#removedListeners) {
            listener(nodeId);
        }
    }

    /** Translates a NodeId to its ClientNode, or undefined if the node is not mapped. */
    getNode(nodeId: NodeId): ClientNode | undefined {
        return this.#nodes.get(nodeId);
    }

    /**
     * Translates an EndpointId to the node and endpoint number it addresses, or undefined when it
     * is not mapped. The lookup behind every read, write and invoke, so it is a map access and
     * never a query.
     */
    resolveEndpoint(endpointId: EndpointId): ResolvedEndpoint | undefined {
        return this.#endpoints.get(endpointId);
    }

    /** Registers a listener invoked after a node and its endpoints are added. */
    onAdded(listener: AddedListener): Unsubscribe {
        this.#addedListeners.add(listener);
        return () => {
            this.#addedListeners.delete(listener);
        };
    }

    /** Registers a listener invoked after a node and its endpoints are removed. */
    onRemoved(listener: RemovedListener): Unsubscribe {
        this.#removedListeners.add(listener);
        return () => {
            this.#removedListeners.delete(listener);
        };
    }

    /**
     * Empties the map. Called when the provider stops, so a later start rehydrates from the
     * repository into an empty index rather than meeting the nodes of the previous run — which
     * `addNode` refuses, and rightly, since a duplicate anywhere else means a broken invariant.
     *
     * Listeners are left registered: they belong to the gateways, which unsubscribe on their own
     * stop, and a map that outlived its subscribers would be a different bug.
     */
    clear(): void {
        this.#nodes.clear();
        this.#endpoints.clear();
        this.#nodeEndpoints.clear();
    }

    /**
     * The mapped nodes as NodeIdentity records, so a watcher starting after hydration can observe
     * the nodes that were added before it subscribed.
     */
    *nodeIdentities(): IterableIterator<NodeIdentity> {
        for (const [nodeId, node] of this.#nodes) {
            const endpoints: EndpointIdentity[] = [];
            for (const endpointId of this.#nodeEndpoints.get(nodeId) ?? []) {
                const resolved = this.#endpoints.get(endpointId);
                if (resolved !== undefined) {
                    endpoints.push({ endpointId, endpointNumber: resolved.endpointNumber });
                }
            }
            yield { nodeId, node, endpoints };
        }
    }
}
