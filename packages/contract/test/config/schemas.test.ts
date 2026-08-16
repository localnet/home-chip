import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "../../src/common/errors.ts";
import { validateConfig } from "../../src/config/schemas.ts";
import { LogLevel } from "../../src/logger/types.ts";

const DEFAULTS = {
    server: { host: "0.0.0.0", port: 8080 },
    logging: { level: LogLevel.Info, maxFileSize: "10M", maxFiles: 5 },
    matter: { networkInterface: null },
};

describe("config/schemas", () => {
    describe("defaults", () => {
        test("an absent section and an empty one both yield the full defaults", () => {
            assert.deepEqual(validateConfig({}), DEFAULTS);
            assert.deepEqual(validateConfig({ server: {}, logging: {}, matter: {} }), DEFAULTS);
        });

        test("overriding one field leaves its siblings at their defaults", () => {
            const config = validateConfig({ server: { port: 9000 } });

            assert.deepEqual(config.server, { host: "0.0.0.0", port: 9000 });
        });
    });

    describe("server", () => {
        test("host takes an address or a hostname", () => {
            assert.equal(validateConfig({ server: { host: "127.0.0.1" } }).server.host, "127.0.0.1");
            assert.equal(validateConfig({ server: { host: "home-chip.local" } }).server.host, "home-chip.local");
        });

        test("port spans the unprivileged range, so the hub never needs root", () => {
            assert.doesNotThrow(() => validateConfig({ server: { port: 1024 } }));
            assert.doesNotThrow(() => validateConfig({ server: { port: 65535 } }));
        });

        test("rejects an empty host, and a port outside the range or not whole", () => {
            assert.throws(() => validateConfig({ server: { host: "" } }), ValidationError);
            for (const port of [80, 1023, 65536, 8080.5]) {
                assert.throws(() => validateConfig({ server: { port } }), ValidationError);
            }
        });
    });

    describe("logging", () => {
        test("level takes any of the six matter.js levels", () => {
            for (const level of Object.values(LogLevel)) {
                assert.doesNotThrow(() => validateConfig({ logging: { level } }));
            }
        });

        test("maxFileSize takes an integer and one of the four units", () => {
            for (const maxFileSize of ["100B", "10K", "10M", "1G"]) {
                assert.doesNotThrow(() => validateConfig({ logging: { maxFileSize } }));
            }
        });

        test("rejects an unknown level, a malformed size and a maxFiles below one", () => {
            assert.throws(() => validateConfig({ logging: { level: "verbose" } }), ValidationError);
            // No unit, no number, a unit the library does not take, and the lowercase form.
            for (const maxFileSize of ["10", "M", "10T", "10m"]) {
                assert.throws(() => validateConfig({ logging: { maxFileSize } }), ValidationError);
            }
            for (const maxFiles of [0, -1, 5.5]) {
                assert.throws(() => validateConfig({ logging: { maxFiles } }), ValidationError);
            }
        });
    });

    describe("matter", () => {
        test("networkInterface takes a name, or null to let the SDK choose", () => {
            assert.equal(validateConfig({ matter: { networkInterface: "eth0" } }).matter.networkInterface, "eth0");
            assert.equal(validateConfig({ matter: { networkInterface: null } }).matter.networkInterface, null);
        });

        test("rejects an empty interface name", () => {
            assert.throws(() => validateConfig({ matter: { networkInterface: "" } }), ValidationError);
        });
    });

    test("rejects a key it does not know, listing the ones it takes", () => {
        // A hand-edited file with one author: a misspelt key is a mistake to report, not a
        // message from a peer to be tolerant of. The path in data.issues names the culprit and
        // the message names the alternatives, since the nearest key is not reliably the intended
        // one — maxsize sits closer to maxFiles than to maxFileSize.
        assert.throws(() => validateConfig({ serverr: {} }), ValidationError);
        assert.throws(() => validateConfig({ server: { prot: 9000 } }), ValidationError);
        assert.throws(
            () => validateConfig({ logging: { maxsize: "10M" } }),
            (error: unknown) => {
                assert.equal(error instanceof ValidationError, true);
                assert.deepEqual((error as ValidationError).data?.issues, [
                    {
                        path: "logging.maxsize",
                        message: 'unknown key "maxsize", expected one of: level, maxFileSize, maxFiles',
                    },
                ]);
                return true;
            },
        );
    });

    test("rejects a file that does not hold a JSON object", () => {
        // The array is the one that needs guarding: an array satisfies the object schema on its
        // own, strictness being about unknown keys rather than the container, so without the
        // explicit check a file containing [] would validate as an all-defaults config.
        for (const input of ["not an object", 42, null, undefined, []]) {
            assert.throws(() => validateConfig(input), ValidationError);
        }
    });
});
