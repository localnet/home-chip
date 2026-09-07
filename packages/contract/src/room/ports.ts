import type { RoomId } from "../common/ids.ts";
import type { RoomRecord, RoomState } from "./types.ts";

/**
 * Read-only access to the state of every room, implemented by the registry. There are no mutators
 * because there is nothing here to mutate: each call reads the room repository through and holds
 * nothing between calls, a room's whole state living in the database with nothing to compose from
 * the matter side.
 *
 * The room:* events are therefore not what keeps this current. They exist for a consumer that does
 * hold a copy — a connected client — and a caller on this side of the wire asks again rather than
 * tracking them: what these methods return is a point-in-time value, not a live reference.
 */
export interface RoomView {
    list(): RoomState[];
    get(id: RoomId): RoomState | null;
}

/**
 * Persistence of rooms, implemented by the database package. Operations are synchronous (see
 * NodeRepository for the rationale).
 *
 * Deleting a room clears the assignment on its endpoints, through the `ON DELETE SET NULL` on
 * `endpoints.room_id`. No caller clears them separately, and the bus sees a single
 * `room:removed`.
 */
export interface RoomRepository {
    findById(id: RoomId): RoomRecord | null;
    findAll(): RoomRecord[];

    /**
     * Inserts a new record. Rooms are created by the user rather than discovered, so the caller
     * mints the id with `createRoomId()` and can return it without waiting for the event.
     */
    save(record: RoomRecord): void;

    /** Updates the user-assigned name. Throws RoomNotFoundError if the room does not exist. */
    setName(id: RoomId, name: string): void;

    /**
     * Removes the record. Throws RoomNotFoundError if the room does not exist, so a caller can
     * emit `room:removed` on the strength of this call alone rather than reading first to find
     * out whether anything was actually deleted.
     */
    delete(id: RoomId): void;
}
