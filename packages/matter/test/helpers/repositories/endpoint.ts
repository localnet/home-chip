import type { EndpointId, NodeId, RoomId } from "@home-chip/contract/common/ids.ts";
import { EndpointNotFoundError } from "@home-chip/contract/endpoint/errors.ts";
import type { EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@home-chip/contract/endpoint/types.ts";

/**
 * In-memory EndpointRepository for tests. Backs the endpoint view without
 * pulling in @home-chip/database.
 */
export class TestEndpointRepository implements EndpointRepository {
    readonly #records = new Map<EndpointId, EndpointRecord>();

    seed(record: EndpointRecord): void {
        this.#records.set(record.id, record);
    }

    findById(id: EndpointId): EndpointRecord | null {
        return this.#records.get(id) ?? null;
    }

    findByMatterNumber(nodeId: NodeId, matterNumber: number): EndpointRecord | null {
        for (const record of this.#records.values()) {
            if (record.nodeId === nodeId && record.matterNumber === matterNumber) {
                return record;
            }
        }
        return null;
    }

    findAll(): EndpointRecord[] {
        return [...this.#records.values()];
    }

    findByNode(nodeId: NodeId): EndpointRecord[] {
        return [...this.#records.values()].filter((record) => record.nodeId === nodeId);
    }

    save(record: EndpointRecord): void {
        this.#records.set(record.id, record);
    }

    setName(id: EndpointId, name: string): void {
        const record = this.#records.get(id);
        if (record === undefined) {
            throw new EndpointNotFoundError(id);
        }
        this.#records.set(id, { ...record, name });
    }

    setRoom(id: EndpointId, roomId: RoomId | null): void {
        const record = this.#records.get(id);
        if (record === undefined) {
            throw new EndpointNotFoundError(id);
        }
        this.#records.set(id, { ...record, roomId });
    }

    delete(id: EndpointId): void {
        this.#records.delete(id);
    }
}
