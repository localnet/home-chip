import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { createEndpointId, createNodeId, createRoomId, isUuidV7 } from "../../src/common/ids.ts";

describe("common/ids", () => {
    describe("createNodeId / createEndpointId / createRoomId", () => {
        test("mint values that the format check accepts", () => {
            // Coherence between the factories and the check, without re-implementing the
            // UUID v7 pattern here: it lives in ids.ts and is the single source of truth.
            assert.equal(isUuidV7(createNodeId()), true);
            assert.equal(isUuidV7(createEndpointId()), true);
            assert.equal(isUuidV7(createRoomId()), true);
        });
    });

    describe("isUuidV7", () => {
        test("rejects non-string values", () => {
            for (const value of [undefined, null, 42, true, {}, []]) {
                assert.equal(isUuidV7(value), false);
            }
        });

        test("rejects strings that are not UUID v7", () => {
            const invalid = [
                "",
                "not-a-uuid",
                "550e8400-e29b-41d4-a716",
                // UUID v1: version nibble is 1
                "550e8400-e29b-11d4-a716-446655440000",
                // UUID v4: version nibble is 4. Rejected on purpose — every id in the system
                // comes from the factories above, so another version is a bug or a forgery.
                "550e8400-e29b-41d4-a716-446655440000",
                // Variant nibble c, outside the 8/9/a/b the format requires
                "017f22e2-79b0-7cc3-c98c-446655440000",
            ];

            for (const value of invalid) {
                assert.equal(isUuidV7(value), false, `expected ${value} to be rejected`);
            }
        });

        test("accepts uppercase hex as well as lowercase", () => {
            assert.equal(isUuidV7("017F22E2-79B0-7CC3-98C4-446655440000"), true);
            assert.equal(isUuidV7("017f22e2-79b0-7cc3-98c4-446655440000"), true);
        });
    });
});
