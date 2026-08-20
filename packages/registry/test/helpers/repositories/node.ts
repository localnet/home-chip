import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { NodeRecord } from "@home-chip/contract/node/types.ts";

// The views read and never write, and findByMatterId belongs to the matter adapter. Anything
// reached from here beyond the two readers is a bug in the view, so it fails loudly.
const unused = (name: string): never => {
    throw new Error(`fake node repository: ${name} is not exercised by the registry`);
};

/** In-memory NodeRepository, so the node view can be tested without @home-chip/database. */
export class TestNodeRepository implements NodeRepository {
    readonly #records = new Map<NodeId, NodeRecord>();

    seed(record: NodeRecord): void {
        this.#records.set(record.id, record);
    }

    findById(id: NodeId): NodeRecord | null {
        return this.#records.get(id) ?? null;
    }

    findAll(): NodeRecord[] {
        return [...this.#records.values()];
    }

    findByMatterId(): NodeRecord | null {
        return unused("findByMatterId");
    }

    save(): void {
        unused("save");
    }

    delete(): void {
        unused("delete");
    }
}
