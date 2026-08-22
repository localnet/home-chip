import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { createRoomId, type RoomId } from "@home-chip/contract/common/ids.ts";
import { RoomNotFoundError } from "@home-chip/contract/room/errors.ts";

import { RoomUseCase } from "../../src/use-cases/room.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { TestRoomRepository } from "../helpers/repositories/room.ts";

const R1 = createRoomId();

const setup = (): { repo: TestRoomRepository; bus: TestEventBus; useCase: RoomUseCase } => {
    const repo = new TestRoomRepository();
    const bus = new TestEventBus();
    return { repo, bus, useCase: new RoomUseCase({ roomRepository: repo, bus }) };
};

const emittedNames = (bus: TestEventBus): string[] => bus.emitted.map((entry) => entry.name);

describe("RoomUseCase", () => {
    test("create saves the room, returns its id, and announces it", () => {
        const { repo, bus, useCase } = setup();

        const id = useCase.create("Kitchen");

        assert.equal(repo.findById(id)?.name, "Kitchen");
        const event = bus.emitted.find((entry) => entry.name === "room:added");
        assert.ok(event);
        assert.deepEqual((event.payload as { room: { id: RoomId; name: string } }).room, { id, name: "Kitchen" });
    });

    test("rename and remove persist first, then announce", () => {
        const { repo, bus, useCase } = setup();
        repo.seed({ id: R1, name: "Kitchen" });

        useCase.rename(R1, "Dining");
        assert.equal(repo.findById(R1)?.name, "Dining");

        useCase.remove(R1);
        assert.equal(repo.findById(R1), null);

        assert.deepEqual(emittedNames(bus), ["room:renamed", "room:removed"]);
    });

    test("an id that matches nothing fails before anything is announced", () => {
        // The repository is what reports it, so neither method reads first. What matters here is
        // that the throw reaches the caller with no event left behind.
        const { bus, useCase } = setup();

        assert.throws(() => useCase.rename(R1, "Dining"), RoomNotFoundError);
        assert.throws(() => useCase.remove(R1), RoomNotFoundError);
        assert.deepEqual(emittedNames(bus), []);
    });
});
