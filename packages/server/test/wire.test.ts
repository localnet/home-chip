import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { NotFoundError, ValidationError } from "@home-chip/contract/common/errors.ts";
import { JsonRpcErrorCode } from "@home-chip/contract/server/types.ts";

import { parseClientMessage, toJsonRpcError } from "../src/wire.ts";

describe("parseClientMessage", () => {
    test("classifies by the presence of an id: with one a request, without one a notification", () => {
        assert.ok("request" in parseClientMessage(JSON.stringify({ jsonrpc: "2.0", method: "test.echo", id: 1 })));
        assert.ok("notification" in parseClientMessage(JSON.stringify({ jsonrpc: "2.0", method: "test.echo" })));
    });

    test("answers unreadable JSON with ParseError under a null id", () => {
        const outcome = parseClientMessage("{ not json");

        assert.ok("error" in outcome);
        assert.equal(outcome.error.error.code, JsonRpcErrorCode.ParseError);
        assert.equal(outcome.error.id, null);
    });

    test("answers a malformed envelope with InvalidRequest, passing the issues on", () => {
        // The id is null because there is none to trust. The issues are what tell the client
        // which member is wrong rather than only that the message was refused.
        const outcome = parseClientMessage(JSON.stringify({ method: "test.echo", id: 1 }));

        assert.ok("error" in outcome);
        assert.equal(outcome.error.error.code, JsonRpcErrorCode.InvalidRequest);
        assert.equal(outcome.error.id, null);
        assert.ok(Array.isArray((outcome.error.error.data as { issues?: unknown[] }).issues));
    });

    test("refuses positional params as InvalidParams, echoing the request id", () => {
        // Section 4.2 makes an array a valid Request object, so the request is well formed and it
        // is the parameters this hub cannot work with — hence -32602 and not -32600, and hence an
        // id the client can correlate.
        const outcome = parseClientMessage(JSON.stringify({ jsonrpc: "2.0", method: "sum", params: [1, 2], id: 7 }));

        assert.ok("error" in outcome);
        assert.equal(outcome.error.error.code, JsonRpcErrorCode.InvalidParams);
        assert.equal(outcome.error.id, 7);
        assert.deepEqual(outcome.error.error.data, { method: "sum" });
    });
});

describe("toJsonRpcError", () => {
    test("maps each kind of error to its JSON-RPC form", () => {
        const cases = [
            // Field paths travel in data, for a client to point at the offending input.
            {
                error: new ValidationError("params invalid", { data: { field: "name" } }),
                expected: { code: JsonRpcErrorCode.InvalidParams, message: "params invalid", data: { field: "name" } },
            },
            // Any other AppError adds its own code to data, the one field a client branches on.
            {
                error: new NotFoundError("node not found", { data: { id: "n1" } }),
                expected: {
                    code: JsonRpcErrorCode.ApplicationError,
                    message: "node not found",
                    data: { id: "n1", code: "NOT_FOUND_ERROR" },
                },
            },
            // Anything else keeps its message to itself: it was never written for a client, and
            // may carry a host, a path or a secret.
            {
                error: new Error("connection failed at host=secret"),
                expected: { code: JsonRpcErrorCode.InternalError, message: "Internal error" },
            },
        ];

        for (const { error, expected } of cases) {
            assert.deepEqual(toJsonRpcError(error), expected, error.constructor.name);
        }
    });
});
