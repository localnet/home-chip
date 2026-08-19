import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite";

import type { NodeId } from "@home-chip/contract/common/ids.ts";
import { NodeNotFoundError } from "@home-chip/contract/node/errors.ts";
import type { NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { NodeRecord } from "@home-chip/contract/node/types.ts";

/**
 * A Matter node id is a uint64 and SQLite's INTEGER is a signed int64, so a value with bit 63 set
 * cannot be bound as it stands. The same 64 bits go in reinterpreted as signed and come back out
 * as unsigned: the round trip is exact and equality survives it, so findByMatterId still matches.
 * The cost is that such ids read as negative to anyone opening the file with the sqlite3 CLI,
 * which nothing does in normal operation.
 */
const toStorageId = (value: bigint): bigint => BigInt.asIntN(64, value);
const fromStorageId = (value: bigint): bigint => BigInt.asUintN(64, value);

const toRecord = (row: Record<string, SQLOutputValue>): NodeRecord => ({
    id: row.id as NodeId,
    matterId: fromStorageId(row.matter_id as bigint),
});

const COLUMNS = "id, matter_id";

/**
 * The `nodes` table. Every statement that reads matter_id opts into BigInt, node:sqlite otherwise
 * returning it as a JS number and throwing on anything past the safe range. Writes take a bigint
 * as they are.
 */
export class SqliteNodeRepository implements NodeRepository {
    readonly #findById: StatementSync;
    readonly #findByMatterId: StatementSync;
    readonly #findAll: StatementSync;
    readonly #insert: StatementSync;
    readonly #delete: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare(`SELECT ${COLUMNS} FROM nodes WHERE id = ?`, {
            readBigInts: true,
        });
        this.#findByMatterId = connection.prepare(`SELECT ${COLUMNS} FROM nodes WHERE matter_id = ?`, {
            readBigInts: true,
        });
        this.#findAll = connection.prepare(`SELECT ${COLUMNS} FROM nodes ORDER BY id`, {
            readBigInts: true,
        });
        this.#insert = connection.prepare(`INSERT INTO nodes (${COLUMNS}) VALUES (?, ?)`);
        this.#delete = connection.prepare("DELETE FROM nodes WHERE id = ?");
    }

    findById(id: NodeId): NodeRecord | null {
        const row = this.#findById.get(id);
        return row === undefined ? null : toRecord(row);
    }

    findByMatterId(matterId: bigint): NodeRecord | null {
        const row = this.#findByMatterId.get(toStorageId(matterId));
        return row === undefined ? null : toRecord(row);
    }

    findAll(): NodeRecord[] {
        return this.#findAll.all().map(toRecord);
    }

    save(record: NodeRecord): void {
        this.#insert.run(record.id, toStorageId(record.matterId));
    }

    delete(id: NodeId): void {
        // `changes` is what tells a removal from a no-op, so a caller can emit node:removed on
        // the strength of this call rather than reading first to find out whether anything went.
        const { changes } = this.#delete.run(id);
        if (changes === 0) {
            throw new NodeNotFoundError(id);
        }
    }
}
