import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "@home-chip/contract/common/errors.ts";
import { createRoomId, type RoomId } from "@home-chip/contract/common/ids.ts";
import type { RoomState } from "@home-chip/contract/room/types.ts";

import type { HandlerTable } from "../../src/dispatcher.ts";
import { roomHandlers } from "../../src/handlers/room.ts";
import { RoomUseCase } from "../../src/use-cases/room.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { TestRoomRepository } from "../helpers/repositories/room.ts";
import { TestView } from "../helpers/view.ts";

const R1 = createRoomId();

const call = (table: HandlerTable, method: string, params?: unknown): unknown => {
    const handler = table[method];
    assert.ok(handler, `no handler registered for ${method}`);
    return handler(params);
};

const setup = () => {
    const roomRepository = new TestRoomRepository();
    const bus = new TestEventBus();
    const roomView = new TestView<RoomId, RoomState>();
    const handlers = roomHandlers({ roomView, roomUseCase: new RoomUseCase({ roomRepository, bus }) });
    return { roomRepository, roomView, handlers };
};

describe("roomHandlers", () => {
    test("registers exactly the room namespace", () => {
        // The wire surface of the namespace. A method added or dropped without meaning to shows
        // up here, and nowhere else in this package.
        assert.deepEqual(Object.keys(setup().handlers).sort(), [
            "room.add",
            "room.get",
            "room.list",
            "room.remove",
            "room.setName",
        ]);
    });

    test("reads come from the view, writes reach the use-case", () => {
        // What the handler owns is the wiring: parsed params in, the collaborator's answer out.
        // What the write then does to the repository and the bus is RoomUseCase's own test.
        const { roomRepository, roomView, handlers } = setup();
        roomView.seed({ id: R1, name: "Kitchen" });

        assert.deepEqual(call(handlers, "room.list"), [{ id: R1, name: "Kitchen" }]);
        assert.deepEqual(call(handlers, "room.get", { id: R1 }), { id: R1, name: "Kitchen" });

        const created = call(handlers, "room.add", { name: "Bedroom" }) as RoomId;
        assert.equal(roomRepository.findById(created)?.name, "Bedroom");
    });

    test("every handler validates its params before reaching the collaborator", () => {
        const { handlers } = setup();

        for (const [method, params] of [
            ["room.get", {}],
            ["room.add", { name: "" }],
            ["room.setName", { id: R1 }],
            ["room.remove", { id: "not-a-uuid" }],
        ] as const) {
            assert.throws(() => call(handlers, method, params), ValidationError, method);
        }
    });
});
