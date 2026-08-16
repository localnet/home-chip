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
     * An endpoint became known to the system. Emitted after the commissioning transaction
     * persists, so the state is complete and durable before any consumer sees it: the registry
     * only has to store `endpoint`, and the server retransmits it so clients can render the new
     * endpoint without a follow-up read. It carries the full state rather than ids because the
     * bus is synchronous — a handler cannot assemble the state asynchronously.
     *
     * At this point `name` is the default the matter adapter derived from Basic Information
     * during the commissioning interview, and `roomId` is always `null`, since assigning a room
     * is a later user action reported through `endpoint:room-changed`. A Matter Bridge that adds
     * an endpoint during normal operation emits the same event, assembled the same way.
     */
    "endpoint:added": {
        readonly endpoint: EndpointState;
        readonly timestamp: number;
    };

    /**
     * An endpoint was removed from a node. Only for dynamic removals from a Matter Bridge:
     * decommissioning a whole node emits `node:removed` and not one of these per endpoint.
     */
    "endpoint:removed": {
        readonly endpointId: EndpointId;
        readonly nodeId: NodeId;
        readonly timestamp: number;
    };

    /**
     * An attribute changed: a light turned on, a sensor reported, a lock moved. Emitted by the
     * matter adapter on every attribute report, consumed by the registry to update its state and
     * by the server to notify connected clients.
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
