import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite";

import type { RoomId } from "@home-chip/contract/common/ids.ts";
import { RoomNotFoundError } from "@home-chip/contract/room/errors.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";
import type { RoomRecord } from "@home-chip/contract/room/types.ts";

const toRecord = (row: Record<string, SQLOutputValue>): RoomRecord => ({
    id: row.id as RoomId,
    name: row.name as string,
});

const COLUMNS = "id, name";

/**
 * The `rooms` table. Synchronous throughout, as node:sqlite and the port both are. The connection
 * arrives from the provider, which owns its lifecycle.
 *
 * Statements are prepared once in the constructor and reused, which is also where a mistyped
 * column surfaces — at start, rather than the first time a method runs.
 */
export class SqliteRoomRepository implements RoomRepository {
    readonly #findById: StatementSync;
    readonly #findAll: StatementSync;
    readonly #insert: StatementSync;
    readonly #updateName: StatementSync;
    readonly #delete: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare(`SELECT ${COLUMNS} FROM rooms WHERE id = ?`);
        this.#findAll = connection.prepare(`SELECT ${COLUMNS} FROM rooms ORDER BY name`);
        this.#insert = connection.prepare(`INSERT INTO rooms (${COLUMNS}) VALUES (?, ?)`);
        this.#updateName = connection.prepare("UPDATE rooms SET name = ? WHERE id = ?");
        this.#delete = connection.prepare("DELETE FROM rooms WHERE id = ?");
    }

    findById(id: RoomId): RoomRecord | null {
        const row = this.#findById.get(id);
        return row === undefined ? null : toRecord(row);
    }

    findAll(): RoomRecord[] {
        return this.#findAll.all().map(toRecord);
    }

    save(record: RoomRecord): void {
        this.#insert.run(record.id, record.name);
    }

    setName(id: RoomId, name: string): void {
        const { changes } = this.#updateName.run(name, id);
        if (changes === 0) {
            throw new RoomNotFoundError(id);
        }
    }

    delete(id: RoomId): void {
        // Same as setName: an id that matches nothing is reported rather than passed over, so a
        // caller can emit room:removed without reading first.
        const { changes } = this.#delete.run(id);
        if (changes === 0) {
            throw new RoomNotFoundError(id);
        }
    }
}
