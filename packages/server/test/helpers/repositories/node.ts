import type { NodeId } from "@home-chip/contract/common/ids.ts";
import { NodeNotFoundError } from "@home-chip/contract/node/errors.ts";
import type { NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { NodeRecord } from "@home-chip/contract/node/types.ts";

// The use-cases look a node up by id, save it and delete it. The rest fail loudly rather than
// answering, so a use-case reaching for one is a test failure and not a silent pass.
const unused = (name: string): never => {
    throw new Error(`fake node repository: ${name} is not exercised by the server`);
};

/** In-memory NodeRepository, so the use-cases can be tested without @home-chip/database. */
export class TestNodeRepository implements NodeRepository {
    readonly #records = new Map<NodeId, NodeRecord>();
    #deleteError: Error | undefined;

    seed(record: NodeRecord): void {
        this.#records.set(record.id, record);
    }

    /** Makes delete() throw `error`, leaving the record in place, as a write that failed would. */
    failDeleteWith(error: Error): void {
        this.#deleteError = error;
    }

    findById(id: NodeId): NodeRecord | null {
        return this.#records.get(id) ?? null;
    }

    findByMatterId(): NodeRecord | null {
        return unused("findByMatterId");
    }

    findAll(): NodeRecord[] {
        return unused("findAll");
    }

    save(record: NodeRecord): void {
        this.#records.set(record.id, record);
    }

    delete(id: NodeId): void {
        if (this.#deleteError !== undefined) {
            throw this.#deleteError;
        }
        if (!this.#records.delete(id)) {
            throw new NodeNotFoundError(id);
        }
    }
}
