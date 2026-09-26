import type { NodeId } from "../common/ids.ts";
import type { EndpointState } from "../endpoint/types.ts";
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
     * transaction persists node and endpoints, and the only event commissioning emits: the
     * endpoints a node arrives with travel inside it, not as one `endpoint:added` each, that event
     * being for an endpoint turning up on a node already known.
     *
     * It carries the full state, its endpoints' included, because the server forwards a payload to
     * its subscribers as it stands, with no read of its own: what a client needs to render the node
     * has to be in the event, or the client would have to ask for it, and a change could reach it
     * while it waited. The endpoint states are composed in the same turn as the emit, from the
     * cache the SDK updates before it announces a change. So an `endpoint:changed` that follows
     * the event on the connection is no older than its payload, and one that precedes it — the
     * adapter watches a node from the moment commissioning registers it, before this event — is
     * already reflected in it; `endpoint:changed` says what a client does with each.
     * `reachable` is the matter adapter's answer, as in every `NodeState`, and a client takes it
     * as given rather than assuming it true: commissioning has just brought the node online,
     * which is why it normally is.
     */
    "node:added": {
        readonly node: NodeState;
        readonly endpoints: readonly EndpointState[];
        readonly timestamp: number;
    };

    /**
     * A node was decommissioned and left the fabric. Its endpoints are deleted by the
     * `ON DELETE CASCADE` on `endpoints.node_id` and get no individual `endpoint:removed` events,
     * so a consumer drops everything tied to this nodeId on receipt.
     *
     * Not a mirror of `node:added`, which carries its endpoints because the client has never seen
     * them. Here it holds them all already, each `EndpointState` naming its node, so the nodeId
     * identifies every one and a list of their ids would add nothing but a second account of them
     * that could disagree with the first.
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
