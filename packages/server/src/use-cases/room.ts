import { createRoomId, type RoomId } from "@home-chip/contract/common/ids.ts";
import type { DomainEventBus } from "@home-chip/contract/events.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";

/** Collaborators for room management: the repository and the bus. */
export interface RoomDeps {
    readonly roomRepository: RoomRepository;
    readonly bus: DomainEventBus;
}

/**
 * Room management: create, rename, remove. All three persist and then emit, synchronously.
 *
 * `create` mints the id — rooms are made by the user, not discovered — and returns it so a client
 * can reference the new room without waiting for the event. The other two lean on the repository
 * reporting an id that matches nothing, which propagates before any event is emitted, so a failed
 * write never produces a phantom one. Removing a room clears it from its endpoints through the
 * database cascade, and consumers do the same on `room:removed`.
 */
export class RoomUseCase {
    readonly #roomRepository: RoomRepository;
    readonly #bus: DomainEventBus;

    constructor(deps: RoomDeps) {
        this.#roomRepository = deps.roomRepository;
        this.#bus = deps.bus;
    }

    create(name: string): RoomId {
        const id = createRoomId();
        this.#roomRepository.save({ id, name });
        this.#bus.emit("room:added", { room: { id, name }, timestamp: Date.now() });
        return id;
    }

    rename(id: RoomId, name: string): void {
        this.#roomRepository.setName(id, name);
        this.#bus.emit("room:renamed", { roomId: id, name, timestamp: Date.now() });
    }

    remove(id: RoomId): void {
        this.#roomRepository.delete(id);
        this.#bus.emit("room:removed", { roomId: id, timestamp: Date.now() });
    }
}
