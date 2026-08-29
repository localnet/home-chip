import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { NodeRecord } from "@home-chip/contract/node/types.ts";

/**
 * In-memory NodeRepository for tests. Backs the node view without
 * pulling in @home-chip/database.
 */
export class TestNodeRepository implements NodeRepository {
    readonly #records = new Map<NodeId, NodeRecord>();

    seed(record: NodeRecord): void {
        this.#records.set(record.id, record);
    }

    findById(id: NodeId): NodeRecord | null {
        return this.#records.get(id) ?? null;
    }

    findByMatterId(matterId: bigint): NodeRecord | null {
        for (const record of this.#records.values()) {
            if (record.matterId === matterId) {
                return record;
            }
        }
        return null;
    }

    findAll(): NodeRecord[] {
        return [...this.#records.values()];
    }

    save(record: NodeRecord): void {
        this.#records.set(record.id, record);
    }

    delete(id: NodeId): void {
        this.#records.delete(id);
    }
}
