import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "@home-chip/contract/common/errors.ts";
import { createEndpointId, createNodeId, type EndpointId } from "@home-chip/contract/common/ids.ts";
import { EndpointNotFoundError } from "@home-chip/contract/endpoint/errors.ts";
import type { EndpointState } from "@home-chip/contract/endpoint/types.ts";

import type { HandlerTable } from "../../src/dispatcher.ts";
import { endpointHandlers } from "../../src/handlers/endpoint.ts";
import { EndpointUseCase } from "../../src/use-cases/endpoint.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { TestEndpointGateway } from "../helpers/gateways/endpoint.ts";
import { TestEndpointRepository } from "../helpers/repositories/endpoint.ts";
import { TestRoomRepository } from "../helpers/repositories/room.ts";
import { TestView } from "../helpers/view.ts";

const E1 = createEndpointId();
const N1 = createNodeId();

const STATE: EndpointState = {
    id: E1,
    nodeId: N1,
    deviceType: 256,
    name: "Light",
    roomId: null,
    clusters: [],
};

const call = (table: HandlerTable, method: string, params?: unknown): unknown => {
    const handler = table[method];
    assert.ok(handler, `no handler registered for ${method}`);
    return handler(params);
};

const setup = () => {
    const endpointRepository = new TestEndpointRepository();
    const roomRepository = new TestRoomRepository();
    const endpointGateway = new TestEndpointGateway();
    const endpointView = new TestView<EndpointId, EndpointState>();
    const handlers = endpointHandlers({
        endpointView,
        endpointUseCase: new EndpointUseCase({
            endpointRepository,
            roomRepository,
            endpointGateway,
            bus: new TestEventBus(),
        }),
    });
    return { endpointRepository, endpointGateway, endpointView, handlers };
};

describe("endpointHandlers", () => {
    test("registers exactly the endpoint namespace", () => {
        assert.deepEqual(Object.keys(setup().handlers).sort(), [
            "endpoint.get",
            "endpoint.invoke",
            "endpoint.list",
            "endpoint.read",
            "endpoint.setName",
            "endpoint.setRoom",
            "endpoint.write",
        ]);
    });

    test("reads come from the view, device operations reach the gateway", async () => {
        const { endpointGateway, endpointView, handlers } = setup();
        endpointView.seed(STATE);
        endpointGateway.setReadValue(true);

        assert.deepEqual(call(handlers, "endpoint.list"), [STATE]);
        assert.deepEqual(call(handlers, "endpoint.get", { id: E1 }), STATE);
        assert.equal(await call(handlers, "endpoint.read", { id: E1, clusterId: 6, attributeId: 0 }), true);
    });

    test("write and invoke carry their payload through to the gateway", async () => {
        const { endpointGateway, handlers } = setup();

        await call(handlers, "endpoint.write", { id: E1, clusterId: 0x0201, attributeId: 0x12, value: 2100 });
        await call(handlers, "endpoint.invoke", { id: E1, clusterId: 8, commandId: 0, args: { level: 200 } });

        assert.deepEqual(endpointGateway.written, [{ id: E1, clusterId: 0x0201, attributeId: 0x12, value: 2100 }]);
        assert.deepEqual(endpointGateway.invoked, [{ id: E1, clusterId: 8, commandId: 0, args: { level: 200 } }]);
    });

    test("every handler validates its params before reaching the collaborator", () => {
        const { handlers } = setup();

        for (const [method, params] of [
            ["endpoint.get", {}],
            ["endpoint.read", { id: E1, clusterId: 6 }],
            ["endpoint.write", { id: E1, clusterId: 6, attributeId: 0 }],
            ["endpoint.invoke", { id: E1, clusterId: 6, commandId: 0, args: null }],
            ["endpoint.setName", { id: E1, name: "" }],
            ["endpoint.setRoom", { id: E1, roomId: "not-a-uuid" }],
        ] as const) {
            assert.throws(() => call(handlers, method, params), ValidationError, method);
        }
        // A room may be cleared, so null passes the schema. What it meets after that — an
        // endpoint or a room that does not exist — is the use-case's answer, not a validation
        // failure, which is what tells the two stages apart.
        assert.throws(() => call(handlers, "endpoint.setRoom", { id: E1, roomId: null }), EndpointNotFoundError);
    });
});
