import type { NodeId } from "../common/ids.ts";
import type { NodeState } from "./types.ts";

/**
 * Node-domain events. A plain interface rather than module augmentation: `contract/events.ts`
 * composes the per-subdomain interfaces explicitly into `DomainEventMap`, so every consumer sees
 * the complete set through the `DomainEventBus` alias with no per-consumer bookkeeping.
 *
 * Names follow `<subject>:<verb-past-tense>`.
 */
export interface NodeEvents {
    /**
     * A node was commissioned and now belongs to the fabric. Emitted after the commissioning
     * transaction persists node and endpoints, immediately before the `endpoint:added` events for
     * the same node. It carries the full state because the bus is synchronous and a handler
     * cannot assemble it asynchronously; the registry only has to store `node`. At this point
     * `reachable` is always true, the session having just been established.
     */
    "node:added": {
        readonly node: NodeState;
        readonly timestamp: number;
    };

    /**
     * A node was decommissioned and left the fabric. Its endpoints are deleted by the
     * `ON DELETE CASCADE` on `endpoints.node_id` and get no individual `endpoint:removed` events,
     * so a consumer drops everything tied to this nodeId on receipt.
     */
    "node:removed": {
        readonly nodeId: NodeId;
        readonly timestamp: number;
    };

    /**
     * The SDK established or re-established a session and the node answers again: on the first
     * connection after boot, once a network glitch heals, or when a battery-powered node wakes.
     * Reachability is node-level because Matter sessions are, so every endpoint of a connected
     * node is reachable.
     */
    "node:connected": {
        readonly nodeId: NodeId;
        readonly timestamp: number;
    };

    /**
     * The SDK lost contact with the node — powered off, out of range, or briefly unreachable.
     * Distinct from `node:removed`: the node still belongs to the fabric. Clients typically grey
     * out its endpoints and disable their command UIs.
     */
    "node:disconnected": {
        readonly nodeId: NodeId;
        readonly timestamp: number;
    };
}
