import type { RoomId } from "../common/ids.ts";
import type { RoomState } from "./types.ts";

/**
 * Room-domain events. A plain interface rather than module augmentation: `contract/events.ts`
 * composes the per-subdomain interfaces explicitly into `DomainEventMap`, so every consumer sees
 * the complete set through the `DomainEventBus` alias with no per-consumer bookkeeping.
 *
 * Names follow `<subject>:<verb-past-tense>`.
 */
export interface RoomEvents {
    /**
     * The user created a room through `room.add`. It carries the full state, as the other
     * `*:added` events do, so a synchronous handler has everything it needs; the registry only
     * has to store `room`. A new room holds no endpoints — assigning them happens later through
     * `endpoint.setRoom`, which emits its own `endpoint:room-changed`.
     */
    "room:added": {
        readonly room: RoomState;
        readonly timestamp: number;
    };

    /**
     * The user deleted a room through `room.remove`. The `ON DELETE SET NULL` on
     * `endpoints.room_id` clears the assignment on every endpoint that pointed at it, and no
     * `endpoint:room-changed` is emitted for any of them — a cascade the database performs
     * deterministically is reported as one event, as `node:removed` is. A consumer holding local
     * state drops the room and nulls the `roomId` of its endpoints on receipt.
     */
    "room:removed": {
        readonly roomId: RoomId;
        readonly timestamp: number;
    };

    /**
     * The user renamed a room through `room.setName`. Emitted after the database update commits,
     * so a consumer can rely on the registry already being current.
     */
    "room:renamed": {
        readonly roomId: RoomId;
        readonly name: string;
        readonly timestamp: number;
    };
}
