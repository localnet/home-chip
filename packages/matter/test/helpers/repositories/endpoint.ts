import type { EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@home-chip/contract/endpoint/types.ts";

// The provider reads the repository only to hydrate, inside start(), and no test here starts it:
// that needs the process-wide SDK environment. Every method fails loudly, so a test that comes to
// reach one finds out rather than being answered by a fake nobody set up.
const unused = (name: string): never => {
    throw new Error(`fake endpoint repository: ${name} is not exercised by these tests`);
};

/** An EndpointRepository for the provider's constructor, which takes one without reading it. */
export class TestEndpointRepository implements EndpointRepository {
    findById(): EndpointRecord | null {
        return unused("findById");
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
