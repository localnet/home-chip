import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { SCHEMA_VERSION } from "../../src/common/version.ts";
import { SchemaVersionMismatchError } from "../../src/server/errors.ts";

describe("server/errors", () => {
    describe("SchemaVersionMismatchError", () => {
        test("reports both versions when the client declared one", () => {
            const received = SCHEMA_VERSION + 1;

            const error = new SchemaVersionMismatchError(received);

            assert.equal(error.code, "VALIDATION_ERROR");
            assert.deepEqual(error.data, { expected: SCHEMA_VERSION, received });
            assert.match(error.message, new RegExp(`expected ${SCHEMA_VERSION}, received ${received}`));
        });

        test("says the version is missing when the client declared none", () => {
            // Absence reaches data as null rather than being dropped, so a client reading the 426
            // body can tell "you sent the wrong version" from "you sent none".
            const error = new SchemaVersionMismatchError(null);

            assert.deepEqual(error.data, { expected: SCHEMA_VERSION, received: null });
            assert.match(error.message, /missing/i);
        });
    });
});
