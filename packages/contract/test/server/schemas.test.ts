import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "../../src/common/errors.ts";
import { validateClientMessage, validateServerMessage } from "../../src/server/schemas.ts";

describe("server/schemas", () => {
    describe("validateClientMessage", () => {
        test("takes a request with either kind of id, with or without params", () => {
            assert.deepEqual(validateClientMessage({ jsonrpc: "2.0", method: "node.list", id: "req-1" }), {
                jsonrpc: "2.0",
                method: "node.list",
                id: "req-1",
            });
            assert.deepEqual(
                validateClientMessage({ jsonrpc: "2.0", method: "node.get", params: { id: "a" }, id: 7 }),
                {
                    jsonrpc: "2.0",
                    method: "node.get",
                    params: { id: "a" },
                    id: 7,
                },
            );
        });

        test("takes params by position as well as by name, which section 4.2 allows", () => {
            // This hub serves by-name only, but that is not the envelope's business: a positional
            // call is a valid Request object, and the adapter turns it away as InvalidParams.
            const message = validateClientMessage({ jsonrpc: "2.0", method: "subtract", params: [42, 23], id: 1 });

            assert.deepEqual(message.params, [42, 23]);
        });

        test("takes a notification, which has no id", () => {
            const message = validateClientMessage({ jsonrpc: "2.0", method: "user.activity", params: { on: true } });

            assert.equal("id" in message, false);
        });

        test("refuses a request whose id is malformed instead of reading it as a notification", () => {
            // What the strict objects are for: a non-strict schema would drop the bad id and the
            // request would pass as a perfectly good notification, losing its correlation.
            assert.throws(() => validateClientMessage({ jsonrpc: "2.0", method: "ping", id: {} }), ValidationError);
            assert.throws(() => validateClientMessage({ jsonrpc: "2.0", method: "ping", id: null }), ValidationError);
        });

        test("refuses a batch, which this hub does not serve", () => {
            assert.throws(
                () => validateClientMessage([{ jsonrpc: "2.0", method: "node.list", id: 1 }]),
                ValidationError,
            );
        });

        test("refuses a malformed envelope", () => {
            const malformed = [
                { jsonrpc: "1.0", method: "ping", id: 1 },
                { jsonrpc: "2.0", id: 1 },
                { jsonrpc: "2.0", method: "", id: 1 },
                { jsonrpc: "2.0", method: "ping", params: null, id: 1 },
                { jsonrpc: "2.0", method: "ping", params: "hello", id: 1 },
                { jsonrpc: "2.0", method: "ping", id: 1, extra: true },
            ];

            for (const input of malformed) {
                assert.throws(() => validateClientMessage(input), ValidationError, JSON.stringify(input));
            }
        });
    });

    describe("validateServerMessage", () => {
        test("takes a success response whatever the result holds", () => {
            for (const result of [{ ok: true }, 42, null]) {
                assert.doesNotThrow(() => validateServerMessage({ jsonrpc: "2.0", id: 1, result }));
            }
        });

        test("takes an error response, with an id or with null when the request had none", () => {
            // Section 5 requires null here when the server could not read the id at all, which is
            // the parse-error case.
            assert.doesNotThrow(() =>
                validateServerMessage({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }),
            );
            assert.doesNotThrow(() =>
                validateServerMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }),
            );
            assert.doesNotThrow(() =>
                validateServerMessage({
                    jsonrpc: "2.0",
                    id: 1,
                    error: { code: -32602, message: "Invalid params", data: { issues: [] } },
                }),
            );
        });

        test("takes a notification, which carries a retransmitted bus event", () => {
            const message = validateServerMessage({
                jsonrpc: "2.0",
                method: "node:added",
                params: { nodeId: "abc", timestamp: 1234 },
            });

            assert.equal("method" in message, true);
        });

        test("refuses a response that is neither one thing nor the other", () => {
            const malformed = [
                // Both result and error, which the spec forbids.
                { jsonrpc: "2.0", id: 1, result: "ok", error: { code: 0, message: "x" } },
                // Neither result, nor error, nor method.
                { jsonrpc: "2.0", id: 1 },
                // A success may not carry a null id; only an error response may.
                { jsonrpc: "2.0", id: null, result: 1 },
                { jsonrpc: "2.0", id: 1, error: { code: -32601 } },
                { jsonrpc: "2.0", id: 1, error: { message: "x" } },
            ];

            for (const input of malformed) {
                assert.throws(() => validateServerMessage(input), ValidationError, JSON.stringify(input));
            }
        });

        test("refuses anything that is not an object", () => {
            for (const input of ["nope", null, []]) {
                assert.throws(() => validateServerMessage(input), ValidationError);
            }
        });
    });
});
