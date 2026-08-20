import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { RoomId } from "@home-chip/contract/common/ids.ts";

import { ComposedRoomView } from "../../src/views/room.ts";
import { TestRoomRepository } from "../helpers/repositories/room.ts";

describe("ComposedRoomView", () => {
    test("list reads the rooms straight through", () => {
        const repository = new TestRoomRepository();
        repository.seed({ id: "r1" as RoomId, name: "Kitchen" });
        repository.seed({ id: "r2" as RoomId, name: "Bedroom" });

        assert.deepEqual(
            [...new ComposedRoomView(repository).list()].sort((a, b) => a.id.localeCompare(b.id)),
            [
                { id: "r1", name: "Kitchen" },
                { id: "r2", name: "Bedroom" },
            ],
        );
    });

    test("get answers with the room, or null when there is none", () => {
        const repository = new TestRoomRepository();
        repository.seed({ id: "r1" as RoomId, name: "Kitchen" });
        const view = new ComposedRoomView(repository);

        assert.deepEqual(view.get("r1" as RoomId), { id: "r1", name: "Kitchen" });
        assert.equal(view.get("missing" as RoomId), null);
    });
});
