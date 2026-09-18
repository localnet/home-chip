import type { NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { NodeRecord } from "@home-chip/contract/node/types.ts";

// The provider reads the repository only to hydrate, inside start(), and no test here starts it:
// that needs the process-wide SDK environment. Every method fails loudly, so a test that comes to
// reach one finds out rather than being answered by a fake nobody set up.
const unused = (name: string): never => {
    throw new Error(`fake node repository: ${name} is not exercised by these tests`);
};

/** A NodeRepository for the provider's constructor, which takes one without reading it. */
export class TestNodeRepository implements NodeRepository {
    findById(): NodeRecord | null {
        return unused("findById");
    }

    findByMatterId(): NodeRecord | null {
        return unused("findByMatterId");
    }

    findAll(): NodeRecord[] {
        return unused("findAll");
    }

    save(): void {
        unused("save");
    }

    delete(): void {
        unused("delete");
    }
}
