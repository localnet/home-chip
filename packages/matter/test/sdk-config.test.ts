// Must precede any "@matter/main" import: see sdk-config.ts
import "../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { Environment, StorageService } from "@matter/main";

describe("sdk-config", () => {
    test("seeds the SQLite storage driver before the environment is built", () => {
        // The value must be in place by the time the storage service reads it, which happens
        // once as the environment is constructed. Importing this module (line 2) is what puts
        // it there; the environment below is only the observation point.
        assert.equal(Environment.default.get(StorageService).configuredDriver, "sqlite");
    });
});
