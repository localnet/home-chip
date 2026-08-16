import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { JsonRpcErrorCode } from "../../src/server/types.ts";

describe("server/types", () => {
    test("JsonRpcErrorCode carries the five standard codes and one application code", () => {
        // The five come from JSON-RPC 2.0 section 5.1 and are not ours to choose. The sixth is,
        // and -32000 is the top of the [-32099, -32000] range the spec reserves for
        // implementation-defined server errors.
        assert.deepEqual(
            { ...JsonRpcErrorCode },
            {
                ParseError: -32700,
                InvalidRequest: -32600,
                MethodNotFound: -32601,
                InvalidParams: -32602,
                InternalError: -32603,
                ApplicationError: -32000,
            },
        );
    });
});
