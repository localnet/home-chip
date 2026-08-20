import type { EndpointId } from "@home-chip/contract/common/ids.ts";
import { EndpointNotFoundError } from "@home-chip/contract/endpoint/errors.ts";
import type { EndpointGateway } from "@home-chip/contract/endpoint/ports.ts";
import type { AttributeValue, EndpointShape } from "@home-chip/contract/endpoint/types.ts";

// The views only ask describe. The rest fail loudly rather than returning a stub, so a view
// reaching for one is a test failure and not a silent pass.
const unused = (name: string): never => {
    throw new Error(`fake endpoint gateway: ${name} is not exercised by the registry`);
};

/**
 * describe() answers with the shape seeded for that id, and throws for one never seeded — the
 * unresolvable endpoint the view has to skip.
 */
export class TestEndpointGateway implements EndpointGateway {
    readonly #shapes = new Map<EndpointId, EndpointShape>();

    seed(id: EndpointId, shape: EndpointShape): void {
        this.#shapes.set(id, shape);
    }

    describe(id: EndpointId): EndpointShape {
        const shape = this.#shapes.get(id);
        if (shape === undefined) {
            throw new EndpointNotFoundError(id);
        }
        return shape;
    }

    read(): Promise<AttributeValue> {
        return unused("read");
    }

    write(): Promise<void> {
        return unused("write");
    }

    invoke(): Promise<void> {
        return unused("invoke");
    }
}
