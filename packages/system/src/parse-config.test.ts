import { deepStrictEqual, throws } from "node:assert";
import { describe, test } from "node:test";
import { parseConfig } from "./parse-config.ts";

describe("parseConfig", () => {
    test("should return Config when content is valid", () => {
        const content = {
            logging: {
                level: "info",
                maxSize: "10M",
                maxFiles: 5,
            },
            matter: {
                networkInterface: null,
            },
            server: {
                host: "0.0.0.0",
                port: 8080,
            },
        };

        const result = parseConfig(JSON.stringify(content), "/path/config.json");

        deepStrictEqual(result, content);
    });

    test("should return Config with defaults when content is partial", () => {
        const content = {};

        const result = parseConfig(JSON.stringify(content), "/path/config.json");

        deepStrictEqual(result, {
            logging: { level: "info", maxSize: "10M", maxFiles: 5 },
            matter: { networkInterface: null },
            server: { host: "0.0.0.0", port: 8080 },
        });
    });

    test("should throw an error with file path when content is not an object", () => {
        const content = "invalid";

        throws(() => parseConfig(JSON.stringify(content), "/path/config.json"), {
            name: "Error",
            message: /^Config error in \/path\/config.json: Invalid/,
        });
    });

    test("should throw an error with file path when content has unknown fields", () => {
        const content = { unknow: "invalid" };

        throws(() => parseConfig(JSON.stringify(content), "/path/config.json"), {
            name: "Error",
            message: /^Config error in \/path\/config.json: Invalid/,
        });
    });

    test("should throw an error with file path when content is invalid", () => {
        const content = {
            logging: { level: "invalid" },
        };

        throws(() => parseConfig(JSON.stringify(content), "/path/config.json"), {
            name: "Error",
            message: /^Config error in \/path\/config.json: Invalid/,
        });
    });

    test("should throw an error with file path when content is invalid JSON", () => {
        const content = "{ unknow: invalid }";

        throws(() => parseConfig(content, "/path/config.json"), {
            name: "Error",
            message: /^Config error in \/path\/config.json: Expected/,
        });
    });
});
