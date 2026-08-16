import type { EndpointState } from "./endpoint/types.ts";
import type { NodeState } from "./node/types.ts";
import type { RoomState } from "./room/types.ts";

/**
 * A consistent point-in-time view of the whole home, composed from every subdomain's live state.
 * It is what `subscribe` returns: a client asks once after connecting and gets a baseline plus
 * the live event stream in one ordered step.
 *
 * A top-level module rather than a subdomain, having no entity, port or events of its own. And
 * `Snapshot` rather than a `*State` name because it is exactly that — a frozen copy of everything
 * — where the per-entity `*State` types model data that goes on changing.
 */
export interface Snapshot {
    readonly nodes: readonly NodeState[];
    readonly endpoints: readonly EndpointState[];
    readonly rooms: readonly RoomState[];
}

/**
 * The method a client sends to receive the {@link Snapshot} and start the event stream.
 *
 * Namespaced under `hub` because the hub as a whole is what is being subscribed to, rather than
 * any one entity: the snapshot spans nodes, endpoints and rooms at once. Every other method is
 * `<entity>.<verb>`, and a bare `subscribe` would be the only one a client could not place.
 *
 * Two calls — read the state, then start listening — would race: an event forwarded between the
 * snapshot's composition and its arrival would be applied on top of a baseline that predates it,
 * putting back state the client had just been told was gone. One call closes that window, since
 * the server composes the snapshot, sends it and only then joins the client to the live set,
 * without yielding in between. Afterwards the client stays current from the events alone and
 * never asks again.
 *
 * That is also why the server transport handles it directly instead of registering it as a routed
 * method: the dispatcher awaits its handlers, and an await between composing and joining is the
 * very gap this avoids. The same shape Home Assistant's Z-Wave and Matter WebSocket servers use
 * for `start_listening`.
 */
export const SUBSCRIBE_METHOD = "hub.subscribe";
