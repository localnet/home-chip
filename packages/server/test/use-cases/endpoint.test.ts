import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { createEndpointId, createNodeId, createRoomId } from "@home-chip/contract/common/ids.ts";
import { EndpointNotFoundError } from "@home-chip/contract/endpoint/errors.ts";
import { RoomNotFoundError } from "@home-chip/contract/room/errors.ts";

import { EndpointUseCase } from "../../src/use-cases/endpoint.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { TestEndpointGateway } from "../helpers/gateways/endpoint.ts";
import { TestEndpointRepository } from "../helpers/repositories/endpoint.ts";
import { TestRoomRepository } from "../helpers/repositories/room.ts";

const E1 = createEndpointId();
const N1 = createNodeId();
const R1 = createRoomId();

const setup = () => {
    const endpointRepository = new TestEndpointRepository();
    const roomRepository = new TestRoomRepository();
    const gateway = new TestEndpointGateway();
    const bus = new TestEventBus();
    const useCase = new EndpointUseCase({ endpointRepository, roomRepository, endpointGateway: gateway, bus });
    endpointRepository.seed({ id: E1, nodeId: N1, matterNumber: 1, name: "Light", roomId: null });
    return { endpointRepository, roomRepository, gateway, bus, useCase };
};

const emittedNames = (bus: TestEventBus): string[] => bus.emitted.map((entry) => entry.name);

describe("EndpointUseCase", () => {
    test("rename persists first, then announces", () => {
        const { endpointRepository, bus, useCase } = setup();

        useCase.rename(E1, "Lamp");

        assert.equal(endpointRepository.findById(E1)?.name, "Lamp");
        const event = bus.emitted.find((entry) => entry.name === "endpoint:renamed");
        assert.ok(event);
        assert.deepEqual(event.payload as { endpointId: string; name: string }, {
            endpointId: E1,
            name: "Lamp",
            timestamp: (event.payload as { timestamp: number }).timestamp,
        });
    });

    test("assignRoom sets a room and clears it again", () => {
        const { endpointRepository, roomRepository, bus, useCase } = setup();
        roomRepository.seed({ id: R1, name: "Kitchen" });

        useCase.assignRoom(E1, R1);
        assert.equal(endpointRepository.findById(E1)?.roomId, R1);

        useCase.assignRoom(E1, null);
        assert.equal(endpointRepository.findById(E1)?.roomId, null);

        assert.deepEqual(emittedNames(bus), ["endpoint:room-changed", "endpoint:room-changed"]);
    });

    test("assignRoom reports a room that does not exist, rather than letting the write fail", () => {
        // Without the check the foreign key refuses the write and the client gets a constraint
        // error naming a column, where it asked about a room.
        const { bus, useCase } = setup();

        assert.throws(() => useCase.assignRoom(E1, R1), RoomNotFoundError);
        assert.deepEqual(emittedNames(bus), []);
    });

    test("an endpoint that matches nothing fails before anything is announced", () => {
        const { roomRepository, bus, useCase } = setup();
        roomRepository.seed({ id: R1, name: "Kitchen" });
        const missing = createEndpointId();

        assert.throws(() => useCase.rename(missing, "Lamp"), EndpointNotFoundError);
        assert.throws(() => useCase.assignRoom(missing, R1), EndpointNotFoundError);
        assert.deepEqual(emittedNames(bus), []);
    });

    test("device operations go through the gateway and announce nothing", async () => {
        // read returns a value, write and invoke are momentary: the resulting state comes back on
        // its own as endpoint:changed from the matter adapter, not from here.
        const { gateway, bus, useCase } = setup();
        gateway.setReadValue(true);

        assert.equal(await useCase.read(E1, 6, 0), true);
        await useCase.write(E1, 0x0201, 0x12, 2100);
        await useCase.invoke(E1, 8, 0, { level: 200 });
        await useCase.invoke(E1, 6, 1);

        assert.deepEqual(gateway.written, [{ id: E1, clusterId: 0x0201, attributeId: 0x12, value: 2100 }]);
        assert.deepEqual(gateway.invoked, [
            { id: E1, clusterId: 8, commandId: 0, args: { level: 200 } },
            { id: E1, clusterId: 6, commandId: 1, args: undefined },
        ]);
        assert.deepEqual(emittedNames(bus), []);
    });
});
