import type { RoomId } from "@home-chip/contract/common/ids.ts";
import { RoomNotFoundError } from "@home-chip/contract/room/errors.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";
import type { RoomRecord } from "@home-chip/contract/room/types.ts";

// The use-cases save, rename and delete rooms, and look one up before assigning it; listing them
// is the view's. The rest fail loudly rather than answering, so a use-case reaching for one is a
// test failure and not a silent pass.
const unused = (name: string): never => {
    throw new Error(`fake room repository: ${name} is not exercised by the server`);
};

/** In-memory RoomRepository, so the use-cases can be tested without @home-chip/database. */
export class TestRoomRepository implements RoomRepository {
    readonly #records = new Map<RoomId, RoomRecord>();

    seed(record: RoomRecord): void {
        this.#records.set(record.id, record);
    }

    findById(id: RoomId): RoomRecord | null {
        return this.#records.get(id) ?? null;
    }

    findAll(): RoomRecord[] {
        return unused("findAll");
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
