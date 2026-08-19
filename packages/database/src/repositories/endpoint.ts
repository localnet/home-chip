import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite";

import type { EndpointId, NodeId, RoomId } from "@home-chip/contract/common/ids.ts";
import { EndpointNotFoundError } from "@home-chip/contract/endpoint/errors.ts";
import type { EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@home-chip/contract/endpoint/types.ts";

const toRecord = (row: Record<string, SQLOutputValue>): EndpointRecord => ({
    id: row.id as EndpointId,
    nodeId: row.node_id as NodeId,
    matterNumber: row.matter_number as number,
    name: row.name as string,
    roomId: row.room_id as RoomId | null,
});

const COLUMNS = "id, node_id, matter_number, name, room_id";

/**
 * The `endpoints` table. A Matter endpoint number is a uint16, so unlike a node id it fits a JS
 * number and needs no BigInt handling.
 */
export class SqliteEndpointRepository implements EndpointRepository {
    readonly #findById: StatementSync;
    readonly #findByMatterNumber: StatementSync;
    readonly #findAll: StatementSync;
    readonly #findByNode: StatementSync;
    readonly #insert: StatementSync;
    readonly #updateName: StatementSync;
    readonly #updateRoom: StatementSync;
    readonly #delete: StatementSync;

    constructor(connection: DatabaseSync) {
        this.#findById = connection.prepare(`SELECT ${COLUMNS} FROM endpoints WHERE id = ?`);
        this.#findByMatterNumber = connection.prepare(
            `SELECT ${COLUMNS} FROM endpoints WHERE node_id = ? AND matter_number = ?`,
        );
        this.#findAll = connection.prepare(`SELECT ${COLUMNS} FROM endpoints ORDER BY node_id, matter_number`);
        this.#findByNode = connection.prepare(
            `SELECT ${COLUMNS} FROM endpoints WHERE node_id = ? ORDER BY matter_number`,
        );
        this.#insert = connection.prepare(`INSERT INTO endpoints (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`);
        this.#updateName = connection.prepare("UPDATE endpoints SET name = ? WHERE id = ?");
        this.#updateRoom = connection.prepare("UPDATE endpoints SET room_id = ? WHERE id = ?");
        this.#delete = connection.prepare("DELETE FROM endpoints WHERE id = ?");
    }

    findById(id: EndpointId): EndpointRecord | null {
        const row = this.#findById.get(id);
        return row === undefined ? null : toRecord(row);
    }

    findByMatterNumber(nodeId: NodeId, matterNumber: number): EndpointRecord | null {
        const row = this.#findByMatterNumber.get(nodeId, matterNumber);
        return row === undefined ? null : toRecord(row);
    }

    findAll(): EndpointRecord[] {
        return this.#findAll.all().map(toRecord);
    }

    findByNode(nodeId: NodeId): EndpointRecord[] {
        return this.#findByNode.all(nodeId).map(toRecord);
    }

    save(record: EndpointRecord): void {
        this.#insert.run(record.id, record.nodeId, record.matterNumber, record.name, record.roomId);
    }

    setName(id: EndpointId, name: string): void {
        const { changes } = this.#updateName.run(name, id);
        if (changes === 0) {
            throw new EndpointNotFoundError(id);
        }
    }

    setRoom(id: EndpointId, roomId: RoomId | null): void {
        const { changes } = this.#updateRoom.run(roomId, id);
        if (changes === 0) {
            throw new EndpointNotFoundError(id);
        }
    }

    delete(id: EndpointId): void {
        // Same as setName and setRoom: an id that matches nothing is reported rather than passed
        // over, so a caller can emit endpoint:removed without reading first.
        const { changes } = this.#delete.run(id);
        if (changes === 0) {
            throw new EndpointNotFoundError(id);
        }
    }
}
