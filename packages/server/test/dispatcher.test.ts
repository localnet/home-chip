import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { NotFoundError, ValidationError } from "@home-chip/contract/common/errors.ts";
import type { JsonRpcErrorResponse, JsonRpcResponse } from "@home-chip/contract/server/schemas.ts";
import { JsonRpcErrorCode } from "@home-chip/contract/server/types.ts";

import { type HandlerTable, JsonRpcDispatcher } from "../src/dispatcher.ts";
import { parseClientMessage } from "../src/wire.ts";
import { TestLogger } from "./helpers/logger.ts";

const request = (method: string, params?: unknown, id: string | number = 1): string =>
    JSON.stringify({ jsonrpc: "2.0", method, params, id });

const handlers: HandlerTable = {
    "test.echo": (params) => params,
    "test.void": () => undefined,
    "test.notFound": () => {
        throw new NotFoundError("missing", { data: { id: "x" } });
    },
    "test.badParams": () => {
        throw new ValidationError("bad", { data: { field: "f" } });
    },
    "test.boom": () => {
        throw new Error("boom");
    },
};

const setup = (): { logger: TestLogger; dispatch: (raw: string) => Promise<JsonRpcResponse | null> } => {
    const logger = new TestLogger();
    const dispatcher = new JsonRpcDispatcher(logger, handlers);
    return { logger, dispatch: (raw) => dispatcher.route(parseClientMessage(raw)) };
};

const failure = (response: JsonRpcResponse | null): JsonRpcErrorResponse => {
    assert.ok(response !== null && "error" in response);
    return response;
};

const logged = (logger: TestLogger, level: string, message: string): boolean =>
    logger.calls.some((call) => call.level === level && call.values[0] === message);

describe("JsonRpcDispatcher", () => {
    test("routes to the handler and answers under the request id, a void result becoming null", async () => {
        const { dispatch } = setup();

        const echoed = await dispatch(request("test.echo", { a: 1 }, 3));
        const empty = await dispatch(request("test.void"));

        assert.deepEqual(echoed, { jsonrpc: "2.0", id: 3, result: { a: 1 } });
        // The spec requires a result member on success, and a void handler yields undefined,
        // which serialization would drop.
        assert.deepEqual(empty, { jsonrpc: "2.0", id: 1, result: null });
    });

    test("drops a notification and answers nothing", async () => {
        const { logger, dispatch } = setup();

        const response = await dispatch(JSON.stringify({ jsonrpc: "2.0", method: "test.echo" }));

        assert.equal(response, null);
        assert.equal(logged(logger, "debug", "discarded client notification"), true);
    });

    test("passes an already-answered parse failure straight through", async () => {
        const { dispatch } = setup();

        assert.equal(failure(await dispatch("{ not json")).error.code, JsonRpcErrorCode.ParseError);
    });

    test("answers an unknown method with MethodNotFound, echoing the id and naming the method", async () => {
        const { dispatch } = setup();

        const response = failure(await dispatch(request("test.nope", {}, 7)));

        assert.equal(response.error.code, JsonRpcErrorCode.MethodNotFound);
        assert.equal(response.id, 7);
        assert.deepEqual(response.error.data, { method: "test.nope" });
    });

    test("hands a thrown error to the wire mapping, logging only what is not an AppError", async () => {
        // Which error becomes which code is wire.ts's business and is tested there; what matters
        // here is that a domain error passes quietly and a bug in a handler is recorded.
        const { logger, dispatch } = setup();

        assert.equal(failure(await dispatch(request("test.notFound"))).error.code, JsonRpcErrorCode.ApplicationError);
        assert.equal(failure(await dispatch(request("test.badParams"))).error.code, JsonRpcErrorCode.InvalidParams);
        assert.equal(logged(logger, "error", "handler threw an unexpected error"), false);

        assert.equal(failure(await dispatch(request("test.boom"))).error.code, JsonRpcErrorCode.InternalError);
        assert.equal(logged(logger, "error", "handler threw an unexpected error"), true);
    });
});
