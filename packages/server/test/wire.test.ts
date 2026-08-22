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
    test("maps a ValidationError to InvalidParams, keeping its field paths", () => {
        const mapped = toJsonRpcError(new ValidationError("params invalid", { data: { field: "name" } }));

        assert.equal(mapped.code, JsonRpcErrorCode.InvalidParams);
        assert.equal(mapped.message, "params invalid");
        assert.deepEqual(mapped.data, { field: "name" });
    });

    test("maps any other AppError to ApplicationError, with its own code in data", () => {
        const mapped = toJsonRpcError(new NotFoundError("node not found", { data: { id: "n1" } }));

        assert.equal(mapped.code, JsonRpcErrorCode.ApplicationError);
        assert.equal(mapped.message, "node not found");
        assert.deepEqual(mapped.data, { id: "n1", code: "NOT_FOUND_ERROR" });
    });

    test("maps anything else to InternalError without leaking its message", () => {
        const mapped = toJsonRpcError(new Error("connection failed at host=secret"));

        assert.equal(mapped.code, JsonRpcErrorCode.InternalError);
        assert.equal(mapped.message, "Internal error");
        assert.equal(mapped.data, undefined);
    });
});
