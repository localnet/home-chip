import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { ValidationError } from "@home-chip/contract/common/errors.ts";

import { loadConfig } from "../src/config.ts";

const directory = mkdtempSync(join(tmpdir(), "home-chip-config-"));

const writeFile = (name: string, contents: string): string => {
    const filePath = join(directory, name);
    writeFileSync(filePath, contents);
    return filePath;
};

describe("config", () => {
    describe("loadConfig", () => {
        test("returns the file's values, defaulted", () => {
            const filePath = writeFile("valid.json", JSON.stringify({ server: { port: 9000 } }));

            const config = loadConfig(filePath);

            // One overridden field and one defaulted sibling is enough to show the contents
            // reached validateConfig; the defaults themselves are the contract's tests to keep.
            assert.equal(config.server.port, 9000);
            assert.equal(config.server.host, "0.0.0.0");
        });

        test("returns the all-defaults config when the file is missing", () => {
            const config = loadConfig(join(directory, "absent.json"));

            assert.equal(config.server.port, 8080);
            assert.equal(config.logger.level, "info");
        });

        test("propagates a read failure unwrapped, the native error naming the path", () => {
            // A directory gives a non-ENOENT read error without depending on chmod. It reaches
            // the caller as it came, which is how it keeps its code and its path.
            assert.throws(() => loadConfig(directory), { name: "Error", code: "EISDIR" });
        });

        test("reports malformed JSON as a ValidationError naming the file", () => {
            // SyntaxError says where in the text the parser gave up but never which file it was
            // reading, and the caller only prints what it is handed.
            const filePath = writeFile("malformed.json", "{ not json");

            assert.throws(
                () => loadConfig(filePath),
                (error: unknown) => {
                    assert.equal(error instanceof ValidationError, true);
                    assert.deepEqual((error as ValidationError).data, { filePath });
                    assert.equal((error as ValidationError).cause instanceof SyntaxError, true);
                    return true;
                },
            );
        });

        test("lets a schema violation through as it came, with its issues", () => {
            // Both failures are ValidationError, so `data` is what tells them apart: a schema
            // violation carries the offending fields, a parse failure the file.
            const filePath = writeFile("privileged-port.json", JSON.stringify({ server: { port: 80 } }));

            assert.throws(
                () => loadConfig(filePath),
                (error: unknown) => {
                    assert.equal(error instanceof ValidationError, true);
                    assert.deepEqual((error as ValidationError).data?.issues, [
                        { path: "server.port", message: "port must be >= 1024" },
                    ]);
                    return true;
                },
            );
        });
    });
});
