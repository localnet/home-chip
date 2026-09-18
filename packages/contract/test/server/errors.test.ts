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
            // The message is where the two cases part, being what leaves the process: the server
            // logs it when it refuses the upgrade, and the 426 it answers with carries no body, so
            // data reaches no client.
            const error = new SchemaVersionMismatchError(null);

            assert.deepEqual(error.data, { expected: SCHEMA_VERSION, received: null });
            assert.match(error.message, /missing/i);
        });
    });
});
