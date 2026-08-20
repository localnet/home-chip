import type { RoomId } from "@home-chip/contract/common/ids.ts";
import type { RoomRepository, RoomView } from "@home-chip/contract/room/ports.ts";
import type { RoomState } from "@home-chip/contract/room/types.ts";

/**
 * A read-through to the repository. A room's whole state lives in the database, with nothing from
 * the matter adapter, so there is nothing to compose and nothing that can fail — the record and
 * the state coincide today, and the return type is what would report it if they stopped.
 *
 * It implements the same port as the other two Views so the three present one read surface and
 * `snapshot` reads them alike.
 */
export class ComposedRoomView implements RoomView {
    readonly #roomRepository: RoomRepository;

    constructor(roomRepository: RoomRepository) {
        this.#roomRepository = roomRepository;
    }

    list(): RoomState[] {
        return this.#roomRepository.findAll();
    }

    get(id: RoomId): RoomState | null {
        return this.#roomRepository.findById(id);
    }
}
