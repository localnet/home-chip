import type { RoomId } from "@home-chip/contract/common/ids.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";
import type { RoomRecord } from "@home-chip/contract/room/types.ts";

// The views read and never write. A mutator reached from here is a read model that writes, so it
// fails loudly rather than quietly doing what was asked.
const unused = (name: string): never => {
    throw new Error(`fake room repository: ${name} is not exercised by the registry`);
};

/** In-memory RoomRepository, so the room view can be tested without @home-chip/database. */
export class TestRoomRepository implements RoomRepository {
    readonly #records = new Map<RoomId, RoomRecord>();

    seed(record: RoomRecord): void {
        this.#records.set(record.id, record);
    }

    findById(id: RoomId): RoomRecord | null {
        return this.#records.get(id) ?? null;
    }

    findAll(): RoomRecord[] {
        return [...this.#records.values()];
    }

    save(): void {
        unused("save");
    }

    setName(): void {
        unused("setName");
    }

    delete(): void {
        unused("delete");
    }
}
