import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";

import { InternalError } from "@home-chip/contract/common/errors.ts";
import type { RoomId } from "@home-chip/contract/common/ids.ts";
import { MigrationFailedError } from "@home-chip/contract/database/errors.ts";

import { createDatabaseProvider } from "../src/database.ts";
import { TestLogger } from "./helpers/logger.ts";

const databasePath = (): string => join(mkdtempSync(join(tmpdir(), "home-chip-db-")), "home-chip.db");

describe("database", () => {
    describe("createDatabaseProvider", () => {
        test("start() applies the schema and hands out working capabilities", async () => {
            const provider = createDatabaseProvider(databasePath(), new TestLogger());

            await provider.start();
            provider.transactor.run(() => provider.room.save({ id: "r1" as RoomId, name: "Sala" }));

            // Reading from all three proves every table of the migration is there.
            assert.equal(provider.room.findAll().length, 1);
            assert.deepEqual(provider.node.findAll(), []);
            assert.deepEqual(provider.endpoint.findAll(), []);
            await provider.stop();
        });

        test("the capabilities are reachable only between start() and stop()", async () => {
            const provider = createDatabaseProvider(databasePath(), new TestLogger());

            assert.throws(() => provider.transactor, InternalError);
            assert.throws(() => provider.node, InternalError);
            assert.throws(() => provider.endpoint, InternalError);
            assert.throws(() => provider.room, InternalError);

            await provider.start();
            await provider.stop();

            assert.throws(() => provider.node, InternalError);
        });

        test("absorbs a repeated start or stop, and keeps the data across a restart", async () => {
            const path = databasePath();
            const provider = createDatabaseProvider(path, new TestLogger());

            await provider.stop();
            await provider.start();
            const room = provider.room;
            await provider.start();
            // Unguarded, the second start() opens another connection over the first, which nothing
            // closes again; every write would still land.
            assert.equal(provider.room, room);
            provider.room.save({ id: "r1" as RoomId, name: "Sala" });
            await provider.stop();
            await provider.stop();

            const logger = new TestLogger();
            const restarted = createDatabaseProvider(path, logger);
            await restarted.start();

            assert.equal(restarted.room.findAll().length, 1);
            // A migration already applied is not applied again: user_version carries over.
            assert.equal(
                logger.calls.some((call) => call.values[0] === "migrated to schema version"),
                false,
            );
            await restarted.stop();
        });

        test("a failing migration fails the start and leaves nothing behind", async () => {
            // A conflicting `rooms` table of another shape, so the v1 DDL cannot run.
            const path = databasePath();
            const raw = new DatabaseSync(path);
            raw.exec("CREATE TABLE rooms (wrong INTEGER) STRICT;");
            raw.close();
            const provider = createDatabaseProvider(path, new TestLogger());

            await assert.rejects(
                () => provider.start(),
                (error: unknown) => {
                    assert.equal(error instanceof MigrationFailedError, true);
                    assert.deepEqual((error as MigrationFailedError).data, {
                        migrationId: "1:initial schema: rooms, nodes, endpoints",
                    });
                    return true;
                },
            );
            // SQLite deletes the -wal file when the last connection to a database closes, and the
            // provider switched to WAL before migrating, so a file still there is the handle
            // #migrate should have closed. Were WAL ever set after the migrations instead, no file
            // would appear either way and this line would prove nothing.
            assert.equal(existsSync(`${path}-wal`), false);
            // Separate from the close: the fields are assigned only once the migrations succeed,
            // which is what leaves the provider unstarted.
            assert.throws(() => provider.room, InternalError);
        });
    });
});
