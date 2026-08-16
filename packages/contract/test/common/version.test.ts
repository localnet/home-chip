import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { isCompatibleSchema, SCHEMA_VERSION } from "../../src/common/version.ts";

describe("common/version", () => {
    describe("isCompatibleSchema", () => {
        test("accepts an exact match with SCHEMA_VERSION", () => {
            assert.equal(isCompatibleSchema(SCHEMA_VERSION), true);
        });

        test("rejects any other version, and a client that declared none", () => {
            assert.equal(isCompatibleSchema(SCHEMA_VERSION - 1), false);
            assert.equal(isCompatibleSchema(SCHEMA_VERSION + 1), false);
            assert.equal(isCompatibleSchema(null), false);
        });
    });
});
