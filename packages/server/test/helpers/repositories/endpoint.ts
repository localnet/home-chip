import type { EndpointId, RoomId } from "@home-chip/contract/common/ids.ts";
import { EndpointNotFoundError } from "@home-chip/contract/endpoint/errors.ts";
import type { EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@home-chip/contract/endpoint/types.ts";

// The use-cases save endpoints at commissioning and edit their name and room; an endpoint leaves
// with its node, through the database cascade, rather than on its own. The rest fail loudly
// rather than answering, so a use-case reaching for one is a test failure and not a silent pass.
const unused = (name: string): never => {
    throw new Error(`fake endpoint repository: ${name} is not exercised by the server`);
};

/** In-memory EndpointRepository, so the use-cases can be tested without @home-chip/database. */
export class TestEndpointRepository implements EndpointRepository {
    readonly #records = new Map<EndpointId, EndpointRecord>();

    seed(record: EndpointRecord): void {
        this.#records.set(record.id, record);
    }

    findById(id: EndpointId): EndpointRecord | null {
        return this.#records.get(id) ?? null;
    }

    findByMatterNumber(): EndpointRecord | null {
        return unused("findByMatterNumber");
    }

    findAll(): EndpointRecord[] {
        return unused("findAll");
    }

    findByNode(): EndpointRecord[] {
        return unused("findByNode");
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

    delete(): void {
        unused("delete");
    }
}
