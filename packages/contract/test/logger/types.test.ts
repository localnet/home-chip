import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { LogLevel } from "../../src/logger/types.ts";

describe("logger/types", () => {
    test("LogLevel names the six levels matter.js accepts", () => {
        // The values go to the SDK unconverted, as `Logger.level = options.logLevel`, and its own
        // LogLevel() throws ImplementationError on a name it does not know. TypeScript sees only
        // strings here, so a typo would surface at runtime and nowhere else.
        assert.deepEqual(
            { ...LogLevel },
            {
                Debug: "debug",
                Info: "info",
                Notice: "notice",
                Warn: "warn",
                Error: "error",
                Fatal: "fatal",
            },
        );
    });
});
