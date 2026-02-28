import { strictEqual } from "node:assert";
import { describe, test } from "node:test";
import { resolvePaths } from "./resolve-paths.ts";

describe("resolvePaths", () => {
    test("should return default paths when no environment variables are set", () => {
        const result = resolvePaths({}, "/path");

        strictEqual(result.configFile, "/path/.home-chip/config.json");
        strictEqual(result.storagePath, "/path/.home-chip/storage");
        strictEqual(result.logPath, "/path/.home-chip/log");
    });

    test("should use HOMECHIP_CONFIG_FILE when defined", () => {
        const result = resolvePaths({ HOMECHIP_CONFIG_FILE: "/etc/home-chip.json" }, "/path");

        strictEqual(result.configFile, "/etc/home-chip.json");
    });

    test("should use HOMECHIP_STORAGE_PATH when defined", () => {
        const result = resolvePaths({ HOMECHIP_STORAGE_PATH: "/var/lib/home-chip" }, "/path");

        strictEqual(result.storagePath, "/var/lib/home-chip");
    });

    test("should use HOMECHIP_LOG_PATH when defined", () => {
        const result = resolvePaths({ HOMECHIP_LOG_PATH: "/var/log/home-chip" }, "/path");

        strictEqual(result.logPath, "/var/log/home-chip");
    });
});
