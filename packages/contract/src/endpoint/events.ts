import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { AttributeValue, EndpointState } from "./types.ts";

/**
 * Endpoint-domain events. A plain interface rather than module augmentation: `contract/events.ts`
 * composes the per-subdomain interfaces explicitly into `DomainEventMap`, so every consumer sees
 * the complete set through the `DomainEventBus` alias with no per-consumer bookkeeping.
 *
 * Names follow `<subject>:<verb-past-tense>`. The colon separates them from object property
 * paths, which matters because these names are also JSON-RPC notification method names.
 */
export interface EndpointEvents {
    /**
     * An endpoint turned up on a node that was already known — a Matter Bridge exposing a device
     * paired with it. Not the endpoints a node arrives with: those travel inside `node:added`. This
     * event is for what appears afterwards.
     *
     * It carries the full state rather than ids for the reason `node:added` does: the server
     * retransmits it as it stands, with no read of its own, and clients render the new endpoint
     * without a follow-up read. `roomId` is always `null`, assigning a room being a later user
     * action reported through `endpoint:room-changed`.
     *
     * Nothing emits it yet: dynamic bridge composition is not implemented, so a bridge's endpoints
     * are the ones the commissioning interview found and no others. It is declared and forwarded
     * regardless, so that the shape a client codes against does not change the day it starts
     * firing.
     */
    "endpoint:added": {
        readonly endpoint: EndpointState;
        readonly timestamp: number;
    };

    /**
     * An endpoint disappeared from a node that stays — a Matter Bridge dropping a device.
     * Decommissioning a whole node emits `node:removed` and not one of these per endpoint, the
     * endpoints going with it through the `ON DELETE CASCADE` on `endpoints.node_id`.
     *
     * Not emitted yet either, for the reason `endpoint:added` is not, and declared for the same
     * one.
     */
    "endpoint:removed": {
        readonly endpointId: EndpointId;
        readonly nodeId: NodeId;
        readonly timestamp: number;
    };

    /**
     * An attribute changed: a light turned on, a sensor reported, a lock moved. Emitted by the
     * matter adapter on every attribute report and consumed by the server, which notifies its
     * connected clients. The registry does not consume it: it reads the value from the SDK's cache
     * when a client next asks, and that cache is what the report just updated.
     *
     * A client is given an endpoint before any change for it: the snapshot and `node:added` are
     * each composed in the turn they are sent, and `endpoint:added` must be too. Should one arrive
     * regardless for an `endpointId` the client does not hold, it drops it and loses nothing: the
     * value is already in the cache, and any state later served for that endpoint is composed
     * from it.
     */
    "endpoint:changed": {
        readonly endpointId: EndpointId;
        readonly clusterId: number;
        readonly attributeId: number;
        readonly value: AttributeValue;
        readonly timestamp: number;
    };

    /**
     * The user renamed an endpoint through `endpoint.setName`. Emitted after the database update
     * commits, so a consumer can rely on the registry already being current. Every connected
     * client receives it and updates without a refresh.
     */
    "endpoint:renamed": {
        readonly endpointId: EndpointId;
        readonly name: string;
        readonly timestamp: number;
    };

    /**
     * The room assignment changed through `endpoint.setRoom`, with `roomId` null when the user
     * cleared it. Same delivery semantics as `endpoint:renamed`.
     */
    "endpoint:room-changed": {
        readonly endpointId: EndpointId;
        readonly roomId: RoomId | null;
        readonly timestamp: number;
    };
}
