import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { ValidationError } from "@home-chip/contract/common/errors.ts";

import { resolveEnvironment } from "../src/environment.ts";

const TOKEN = { HOMECHIP_AUTH_TOKEN: "secret-token" };
const ROOT = join(homedir(), ".home-chip");

describe("environment", () => {
    describe("resolveEnvironment", () => {
        test("falls back to ~/.home-chip when only the token is set", () => {
            assert.deepEqual(resolveEnvironment({ ...TOKEN }), {
                configPath: ROOT,
                storagePath: join(ROOT, "storage"),
                logPath: join(ROOT, "log"),
                authToken: "secret-token",
            });
        });

        test("takes every path from its own variable", () => {
            const environment = resolveEnvironment({
                ...TOKEN,
                HOMECHIP_CONFIG_PATH: "/etc/home-chip",
                HOMECHIP_STORAGE_PATH: "/var/lib/home-chip",
                HOMECHIP_LOG_PATH: "/var/log/home-chip",
            });

            assert.deepEqual(environment, {
                configPath: "/etc/home-chip",
                storagePath: "/var/lib/home-chip",
                logPath: "/var/log/home-chip",
                authToken: "secret-token",
            });
        });

        test("trims values, and treats one left empty as unset", () => {
            const environment = resolveEnvironment({
                HOMECHIP_AUTH_TOKEN: "  secret-token  ",
                HOMECHIP_CONFIG_PATH: "",
                HOMECHIP_STORAGE_PATH: "   ",
                HOMECHIP_LOG_PATH: " /var/log/home-chip ",
            });

            assert.deepEqual(environment, {
                configPath: ROOT,
                storagePath: join(ROOT, "storage"),
                logPath: "/var/log/home-chip",
                authToken: "secret-token",
            });
        });

        test("accepts a token over the whole RFC 7230 character set", () => {
            const token = "Secret-Token_9!#$%&'*+.^`|~";

            assert.equal(resolveEnvironment({ HOMECHIP_AUTH_TOKEN: token }).authToken, token);
        });

        test("rejects a token that is absent, too short or unusable, naming the variable", () => {
            // Validating the token here rather than in the contract's schemas is what lets every
            // failure say which variable to fix; a schema handed a bare string cannot.
            const rejected = [
                {},
                { HOMECHIP_AUTH_TOKEN: "" },
                { HOMECHIP_AUTH_TOKEN: "   " },
                { HOMECHIP_AUTH_TOKEN: "short" },
                { HOMECHIP_AUTH_TOKEN: "has spaces here" },
                // '/' and '=' are RFC 7230 separators, so `openssl rand -base64` output is out.
                { HOMECHIP_AUTH_TOKEN: "bad/token=value" },
            ];

            for (const env of rejected) {
                assert.throws(
                    () => resolveEnvironment(env),
                    (error: unknown) => {
                        assert.equal(error instanceof ValidationError, true, JSON.stringify(env));
                        assert.deepEqual((error as ValidationError).data, { variable: "HOMECHIP_AUTH_TOKEN" });
                        return true;
                    },
                );
            }
        });
    });
});
