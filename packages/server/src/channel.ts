import type { EndpointView } from "@home-chip/contract/endpoint/ports.ts";
import type { DomainEventMap } from "@home-chip/contract/events.ts";
import type { NodeView } from "@home-chip/contract/node/ports.ts";
import type { RoomView } from "@home-chip/contract/room/ports.ts";
import type { JsonRpcId } from "@home-chip/contract/server/schemas.ts";
import type { Snapshot } from "@home-chip/contract/snapshot.ts";
import { WebSocket } from "ws";

import { notification, successResponse } from "./wire.ts";

/** Collaborators: the three views the baseline snapshot is composed from. */
export interface ChannelDeps {
    readonly nodeView: NodeView;
    readonly endpointView: EndpointView;
    readonly roomView: RoomView;
}

/**
 * The event stream, kept out of the transport: who receives events, the baseline they get on
 * subscribing, and the forwarding of every domain event to them. The subscriber set, `subscribe`
 * and `forward` all work on the same state, so they live together; the server owns the transport
 * around them.
 *
 * A connection becomes a subscriber only by asking. Merely being connected is what the WebSocket
 * server already tracks, so this holds the subscribed subset alone.
 */
export class JsonRpcChannel {
    readonly #nodeView: NodeView;
    readonly #endpointView: EndpointView;
    readonly #roomView: RoomView;
    readonly #subscribers = new Set<WebSocket>();

    constructor(deps: ChannelDeps) {
        this.#nodeView = deps.nodeView;
        this.#endpointView = deps.endpointView;
        this.#roomView = deps.roomView;
    }

    /**
     * Composes the baseline, sends it as the response and joins the subscriber set, with no await
     * between the three. Forwarding being synchronous too, no event can land between the snapshot
     * and the client going live: it receives a complete baseline and then every later event, in
     * order. Re-subscribing is safe for the same reason — a fresh baseline, no interleaving.
     */
    subscribe(ws: WebSocket, id: JsonRpcId): void {
        const snapshot: Snapshot = {
            nodes: this.#nodeView.list(),
            endpoints: this.#endpointView.list(),
            rooms: this.#roomView.list(),
        };
        ws.send(JSON.stringify(successResponse(id, snapshot)));
        this.#subscribers.add(ws);
    }

    forward(eventName: keyof DomainEventMap, payload: Record<string, unknown>): void {
        const frame = JSON.stringify(notification(eventName, payload));
        for (const ws of this.#subscribers) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(frame);
            }
        }
    }

    remove(ws: WebSocket): void {
        this.#subscribers.delete(ws);
    }
}
