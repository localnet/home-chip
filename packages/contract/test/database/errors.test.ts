import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { MigrationFailedError } from "../../src/database/errors.ts";

describe("database/errors", () => {
    test("MigrationFailedError names the migration in data and keeps the SQLite error in cause", () => {
        const cause = new Error("near 'CRATE': syntax error");

        const error = new MigrationFailedError("0001-init", cause);

        assert.equal(error.code, "INTEGRATION_ERROR");
        assert.deepEqual(error.data, { migrationId: "0001-init" });
        assert.equal(error.cause, cause);
        // The message stays fixed while the identifier travels in data, as in the rest of the
        // *FailedError family. Only the *NotFoundError family writes its id into the message.
        assert.equal(error.message, "Migration failed");
    });
});
