import type { RoomId } from "@home-chip/contract/common/ids.ts";
import { RoomNotFoundError } from "@home-chip/contract/room/errors.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";
import type { RoomRecord } from "@home-chip/contract/room/types.ts";

/**
 * In-memory RoomRepository for tests. Backs the room view without
 * pulling in @home-chip/database.
 */
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

    save(record: RoomRecord): void {
        this.#records.set(record.id, record);
    }

    setName(id: RoomId, name: string): void {
        const record = this.#records.get(id);
        if (record === undefined) {
            throw new RoomNotFoundError(id);
        }
        this.#records.set(id, { ...record, name });
    }

    delete(id: RoomId): void {
        if (!this.#records.delete(id)) {
            throw new RoomNotFoundError(id);
        }
    }
}
