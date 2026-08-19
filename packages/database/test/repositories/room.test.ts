import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import type { RoomId } from "@home-chip/contract/common/ids.ts";
import { RoomNotFoundError } from "@home-chip/contract/room/errors.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";

import { createDatabaseProvider, type DatabaseProvider } from "../../src/database.ts";
import { TestLogger } from "../helpers/logger.ts";

const room = (id: string, name: string): { id: RoomId; name: string } => ({ id: id as RoomId, name });

describe("SqliteRoomRepository", () => {
    let provider: DatabaseProvider;
    let repository: RoomRepository;

    beforeEach(async () => {
        const path = join(mkdtempSync(join(tmpdir(), "home-chip-room-")), "home-chip.db");
        provider = createDatabaseProvider(path, new TestLogger());
        await provider.start();
        repository = provider.room;
    });

    afterEach(async () => {
        await provider.stop();
    });

    test("round-trips a saved record, and answers null for an unknown id", () => {
        repository.save(room("r1", "Living room"));

        assert.deepEqual(repository.findById("r1" as RoomId), { id: "r1", name: "Living room" });
        assert.equal(repository.findById("missing" as RoomId), null);
    });

    test("findAll orders by name", () => {
        repository.save(room("r1", "Zebra"));
        repository.save(room("r2", "Alpha"));

        assert.deepEqual(
            repository.findAll().map((found) => found.name),
            ["Alpha", "Zebra"],
        );
    });

    test("setName replaces the name", () => {
        repository.save(room("r1", "Old"));

        repository.setName("r1" as RoomId, "New");

        assert.equal(repository.findById("r1" as RoomId)?.name, "New");
    });

    test("delete removes the room", () => {
        repository.save(room("r1", "Living room"));

        repository.delete("r1" as RoomId);

        assert.equal(repository.findById("r1" as RoomId), null);
    });

    test("both mutators report an id that matches nothing", () => {
        // What lets a caller emit room:renamed or room:removed on the strength of the call
        // alone, rather than reading first to find out whether anything happened.
        assert.throws(() => repository.setName("missing" as RoomId, "x"), RoomNotFoundError);
        assert.throws(() => repository.delete("missing" as RoomId), RoomNotFoundError);
    });
});
