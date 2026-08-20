import type { EndpointId } from "@home-chip/contract/common/ids.ts";
import type { EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@home-chip/contract/endpoint/types.ts";

// The views read and never write, and the lookups by matter number or by node belong to the
// matter adapter. Anything reached from here beyond the two readers is a bug in the view.
const unused = (name: string): never => {
    throw new Error(`fake endpoint repository: ${name} is not exercised by the registry`);
};

/** In-memory EndpointRepository, so the endpoint view can be tested without @home-chip/database. */
export class TestEndpointRepository implements EndpointRepository {
    readonly #records = new Map<EndpointId, EndpointRecord>();

    seed(record: EndpointRecord): void {
        this.#records.set(record.id, record);
    }

    findById(id: EndpointId): EndpointRecord | null {
        return this.#records.get(id) ?? null;
    }

    findAll(): EndpointRecord[] {
        return [...this.#records.values()];
    }

    findByMatterNumber(): EndpointRecord | null {
        return unused("findByMatterNumber");
    }

    findByNode(): EndpointRecord[] {
        return unused("findByNode");
    }

    save(): void {
        unused("save");
    }

    setName(): void {
        unused("setName");
    }

    setRoom(): void {
        unused("setRoom");
    }

    delete(): void {
        unused("delete");
    }
}
