import type { EndpointId } from "@home-chip/contract/common/ids.ts";
import type { EndpointGateway } from "@home-chip/contract/endpoint/ports.ts";
import type { AttributeValue, EndpointShape } from "@home-chip/contract/endpoint/types.ts";

// The use-cases call read, write and invoke. describe is the views' and fails loudly rather than
// answering, so a use-case reaching for it is a test failure and not a silent pass.
const unused = (name: string): never => {
    throw new Error(`fake endpoint gateway: ${name} is not exercised by these tests`);
};

/**
 * EndpointGateway fake for the device use-case tests. read, write and invoke record what they
 * were called with, so a test can assert the delegation and its arguments; read answers with the
 * value set. describe is not exercised here.
 */
export class TestEndpointGateway implements EndpointGateway {
    readonly invoked: {
        readonly id: EndpointId;
        readonly clusterId: number;
        readonly commandId: number;
        readonly args?: AttributeValue;
    }[] = [];
    readonly reads: {
        readonly id: EndpointId;
        readonly clusterId: number;
        readonly attributeId: number;
    }[] = [];
    readonly written: {
        readonly id: EndpointId;
        readonly clusterId: number;
        readonly attributeId: number;
        readonly value: AttributeValue;
    }[] = [];
    #readValue: AttributeValue = null;

    setReadValue(value: AttributeValue): void {
        this.#readValue = value;
    }

    async invoke(id: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void> {
        this.invoked.push({ id, clusterId, commandId, args });
    }

    describe(): EndpointShape {
        return unused("describe");
    }

    async read(id: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue> {
        this.reads.push({ id, clusterId, attributeId });
        return this.#readValue;
    }

    async write(id: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void> {
        this.written.push({ id, clusterId, attributeId, value });
    }
}
