import type { EndpointId } from "@home-chip/contract/common/ids.ts";
import type { EndpointGateway } from "@home-chip/contract/endpoint/ports.ts";
import type { AttributeValue, EndpointShape } from "@home-chip/contract/endpoint/types.ts";

/**
 * EndpointGateway fake for the use-case tests. read, write and invoke record what they were
 * called with, so a test can assert the delegation and its arguments; read answers with the value
 * set. describe answers with the shape set for an id and throws for any other, which is how a
 * test makes an endpoint unresolvable.
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
    readonly #shapes = new Map<EndpointId, EndpointShape>();

    setReadValue(value: AttributeValue): void {
        this.#readValue = value;
    }

    setShape(id: EndpointId, shape: EndpointShape): void {
        this.#shapes.set(id, shape);
    }

    async invoke(id: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void> {
        this.invoked.push({ id, clusterId, commandId, args });
    }

    describe(id: EndpointId): EndpointShape {
        const shape = this.#shapes.get(id);
        if (shape === undefined) {
            throw new Error(`fake endpoint gateway: no shape set for ${id}`);
        }
        return shape;
    }

    async read(id: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue> {
        this.reads.push({ id, clusterId, attributeId });
        return this.#readValue;
    }

    async write(id: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void> {
        this.written.push({ id, clusterId, attributeId, value });
    }
}
