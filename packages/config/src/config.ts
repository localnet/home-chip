import { readFileSync } from "node:fs";

import { ValidationError } from "@home-chip/contract/common/errors.ts";
import { type Config, validateConfig } from "@home-chip/contract/config/schemas.ts";

/**
 * Loads, parses and validates the configuration file, returning a fully defaulted `Config`. A
 * missing file yields the all-defaults config, so a hub with nothing but an auth token starts.
 * Synchronous on purpose: this runs once at bootstrap, before anything concurrent exists.
 *
 * Read failures other than a missing file — permissions, a directory where a file was expected —
 * propagate unchanged, the native error already naming both the cause and the path. Malformed
 * JSON does not: `SyntaxError` says where in the text the parser gave up but never which file it
 * was reading, so it is rewrapped with the path in `data`, matching the shape a schema violation
 * arrives in.
 *
 * Takes the composed file path rather than the directory, so the component that owns the file
 * decides its name — the same split as `createStreamProvider` and `createDatabaseProvider`.
 */
export function loadConfig(filePath: string): Config {
    let contents: string;
    try {
        contents = readFileSync(filePath, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return validateConfig({});
        }
        throw error;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(contents);
    } catch (error) {
        throw new ValidationError(`Config file ${filePath} is not valid JSON`, { cause: error, data: { filePath } });
    }

    return validateConfig(parsed);
}
