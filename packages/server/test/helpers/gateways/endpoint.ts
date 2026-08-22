import type { EndpointId } from "@home-chip/contract/common/ids.ts";
import type { EndpointGateway } from "@home-chip/contract/endpoint/ports.ts";
import type { AttributeValue, EndpointShape } from "@home-chip/contract/endpoint/types.ts";

// The use-cases under test call invoke/read; describe is not exercised here and throws so a
// copy that needs it replaces the body deliberately.
const unused = (name: string): never => {
    throw new Error(`fake endpoint gateway: ${name} is not exercised by these tests`);
};

/**
 * EndpointGateway fake for the device use-case tests. invoke and write record what they were
 * called with, so a test can assert the delegation and its arguments, and invoke can be made to
 * throw. describe is not exercised here.
 */
export class TestEndpointGateway implements EndpointGateway {
    readonly invoked: {
        readonly id: EndpointId;
        readonly clusterId: number;
        readonly commandId: number;
        readonly args?: AttributeValue;
    }[] = [];
    readonly written: {
        readonly id: EndpointId;
        readonly clusterId: number;
        readonly attributeId: number;
        readonly value: AttributeValue;
    }[] = [];
    #invokeError: Error | undefined;
    #readValue: AttributeValue = null;

    failInvokeWith(error: Error): void {
        this.#invokeError = error;
    }

    setReadValue(value: AttributeValue): void {
        this.#readValue = value;
    }

    async invoke(id: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void> {
        this.invoked.push({ id, clusterId, commandId, args });
        if (this.#invokeError !== undefined) {
            throw this.#invokeError;
        }
    }

    describe(): EndpointShape {
        return unused("describe");
    }

    async read(): Promise<AttributeValue> {
        return this.#readValue;
    }

    async write(id: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void> {
        this.written.push({ id, clusterId, attributeId, value });
    }
}
