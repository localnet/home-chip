import type { RoomId } from "../common/ids.ts";

/**
 * The live state of a room, as served by `room.list` and `room.get`. A room is purely a
 * user-defined grouping of endpoints, with no Matter counterpart and no protocol semantics;
 * endpoints point at one through their nullable `roomId`.
 */
export interface RoomState {
    readonly id: RoomId;

    /**
     * User-assigned and always non-empty, validated on creation and on rename. Two rooms may
     * carry the same name: uniqueness is not enforced, since the user is entitled to two
     * "Bedroom"s if that is what their home looks like.
     */
    readonly name: string;
}

/**
 * What the database holds for a room. Identical in shape to `RoomState` today, and kept apart
 * because they sit on opposite sides of a boundary: this one is the durable row, that one is
 * what a client is served. Merging them would let a field added for clients — a derived count,
 * an ordering hint — reach into the repository interface by accident.
 */
export interface RoomRecord {
    readonly id: RoomId;
    readonly name: string;
}
