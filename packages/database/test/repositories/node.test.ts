import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import type { NodeId } from "@home-chip/contract/common/ids.ts";
import { NodeNotFoundError } from "@home-chip/contract/node/errors.ts";
import type { NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { NodeRecord } from "@home-chip/contract/node/types.ts";

import { createDatabaseProvider, type DatabaseProvider } from "../../src/database.ts";
import { TestLogger } from "../helpers/logger.ts";

const node = (id: string, matterId: bigint): NodeRecord => ({ id: id as NodeId, matterId });

// Bit 63 set, so it exceeds both Number.MAX_SAFE_INTEGER and SQLite's signed INTEGER.
const HIGH_BIT_ID = 0xfffffffffffffff0n;

describe("SqliteNodeRepository", () => {
    let provider: DatabaseProvider;
    let repository: NodeRepository;

    beforeEach(async () => {
        const path = join(mkdtempSync(join(tmpdir(), "home-chip-node-")), "home-chip.db");
        provider = createDatabaseProvider(path, new TestLogger());
        await provider.start();
        repository = provider.node;
    });

    afterEach(async () => {
        await provider.stop();
    });

    test("round-trips a record, a full uint64 matter id included", () => {
        // The conversion both ways in one assertion: stored as a negative int64, read back as
        // the bigint that went in, which is what keeps findByMatterId matching below.
        const record = node("n1", HIGH_BIT_ID);

        repository.save(record);

        assert.deepEqual(repository.findById("n1" as NodeId), record);
        assert.equal(typeof repository.findById("n1" as NodeId)?.matterId, "bigint");
    });

    test("findByMatterId locates a node by its raw id, high bit or not", () => {
        repository.save(node("n1", 12345n));
        repository.save(node("n2", HIGH_BIT_ID));

        assert.equal(repository.findByMatterId(12345n)?.id, "n1");
        assert.equal(repository.findByMatterId(HIGH_BIT_ID)?.id, "n2");
        assert.equal(repository.findByMatterId(99999n), null);
    });

    test("findAll orders by id", () => {
        repository.save(node("n2", 2n));
        repository.save(node("n1", 1n));

        assert.deepEqual(
            repository.findAll().map((found) => found.id),
            ["n1", "n2"],
        );
    });

    test("refuses a second node carrying the same matter id", () => {
        // The UNIQUE index on matter_id is what tells the commissioning layer it has met this
        // device before, save() being a plain INSERT rather than an upsert. The primary key
        // never collides: a NodeId is minted fresh per commissioning.
        repository.save(node("n1", 100n));

        assert.throws(() => repository.save(node("n2", 100n)));
    });

    test("delete removes the node, and reports an id that matches nothing", () => {
        repository.save(node("n1", 1n));

        repository.delete("n1" as NodeId);

        assert.equal(repository.findById("n1" as NodeId), null);
        assert.throws(() => repository.delete("n1" as NodeId), NodeNotFoundError);
    });
});
