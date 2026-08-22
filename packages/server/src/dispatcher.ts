import { AppError } from "@home-chip/contract/common/errors.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import type { JsonRpcResponse } from "@home-chip/contract/server/schemas.ts";
import { JsonRpcErrorCode } from "@home-chip/contract/server/types.ts";

import { errorResponse, type ParseOutcome, successResponse, toJsonRpcError } from "./wire.ts";

/** A method implementation: validates its own params and returns the method's result. */
export type Handler = (params: unknown) => unknown | Promise<unknown>;

/** Method name to handler. Assembled from the per-subdomain handler groups in server.ts. */
export type HandlerTable = Readonly<Record<string, Handler>>;

/**
 * The JSON-RPC engine: a parsed message in, a response out, or null when there is nothing to
 * reply. It knows the protocol and nothing about nodes, endpoints or rooms — every domain
 * decision is in the injected HandlerTable, which is what lets it be tested with a stub table and
 * no adapters at all.
 *
 * Routing, each stage owning its wire error: an already-answered parse error passes through, a
 * notification is dropped, an unknown method is MethodNotFound, and otherwise the handler runs,
 * its result becoming `result` and its thrown error going through `toJsonRpcError`. Everything
 * past routing echoes the request id so the client can correlate.
 */
export class JsonRpcDispatcher {
    readonly #logger: Logger;
    readonly #handlers: HandlerTable;

    constructor(logger: Logger, handlers: HandlerTable) {
        this.#logger = logger;
        this.#handlers = handlers;
    }

    async route(outcome: ParseOutcome): Promise<JsonRpcResponse | null> {
        if ("error" in outcome) {
            return outcome.error;
        }
        if ("notification" in outcome) {
            // No client-to-server notification is defined; accepting and dropping one beats
            // answering an error the sender has no id to correlate.
            this.#logger.debug("discarded client notification", outcome.notification.method);
            return null;
        }

        const request = outcome.request;
        const handler = this.#handlers[request.method];
        if (handler === undefined) {
            return errorResponse(request.id, {
                code: JsonRpcErrorCode.MethodNotFound,
                message: "Method not found",
                data: { method: request.method },
            });
        }

        try {
            const result = await handler(request.params);
            // The spec requires a `result` member on success, and a void handler yields undefined,
            // which serialization would drop.
            return successResponse(request.id, result ?? null);
        } catch (error) {
            if (!(error instanceof AppError)) {
                // A domain AppError is an expected, client-facing outcome; anything else is a bug
                // in a handler, logged here since its detail never reaches the client.
                this.#logger.error("handler threw an unexpected error", request.method, error);
            }
            return errorResponse(request.id, toJsonRpcError(error));
        }
    }
}
