import { AppError, ValidationError } from "@home-chip/contract/common/errors.ts";
import {
    type JsonRpcError,
    type JsonRpcErrorResponse,
    type JsonRpcId,
    type JsonRpcNotification,
    type JsonRpcRequest,
    type JsonRpcSuccessResponse,
    validateClientMessage,
} from "@home-chip/contract/server/schemas.ts";
import { JsonRpcErrorCode } from "@home-chip/contract/server/types.ts";

/**
 * Translation at the JSON-RPC boundary, and the only place a `jsonrpc: "2.0"` envelope is built.
 * Inbound, {@link parseClientMessage} turns raw text into one of the three things that can
 * arrive; outbound, the envelope constructors build the frames we send and {@link toJsonRpcError}
 * maps an error thrown while handling a request. Both the dispatcher, which routes, and the
 * transport translate through here.
 */

/**
 * The three outcomes of parsing a client message, as a union keyed by which member is present:
 * exactly one of `request`, `notification` or `error`.
 */
export type ParseOutcome =
    | { readonly request: JsonRpcRequest }
    | { readonly notification: JsonRpcNotification }
    | { readonly error: JsonRpcErrorResponse };

export const errorResponse = (id: JsonRpcId | null, error: JsonRpcError): JsonRpcErrorResponse => ({
    jsonrpc: "2.0",
    id,
    error,
});

export const successResponse = (id: JsonRpcId, result: unknown): JsonRpcSuccessResponse => ({
    jsonrpc: "2.0",
    id,
    result,
});

export const notification = (method: string, params: Record<string, unknown>): JsonRpcNotification => ({
    jsonrpc: "2.0",
    method,
    params,
});

/**
 * Parses and envelope-validates a raw client message, each stage owning its wire error: JSON.parse
 * gives ParseError, a failed envelope gives InvalidRequest, and what survives is classified as a
 * request or a notification by the presence of `id`. Envelope failures carry a null id, the id
 * being unknown or untrusted, and pass the validator's issues through so a client learns which
 * member is wrong rather than only that something was.
 *
 * Positional params are refused here, and as InvalidParams rather than InvalidRequest: section 4.2
 * makes an array a valid Request object, so the request is well formed and it is the parameters
 * this hub cannot work with. Refusing once at the envelope answers for every method, none of which
 * takes params by position.
 *
 * Shared by the dispatcher and by the transport, which needs to see the method before routing so
 * it can handle `hub.subscribe` itself, without parsing twice.
 */
export function parseClientMessage(raw: string): ParseOutcome {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { error: errorResponse(null, { code: JsonRpcErrorCode.ParseError, message: "Parse error" }) };
    }

    let message: JsonRpcRequest | JsonRpcNotification;
    try {
        message = validateClientMessage(parsed);
    } catch (error) {
        return {
            error: errorResponse(null, {
                code: JsonRpcErrorCode.InvalidRequest,
                message: "Invalid Request",
                data: error instanceof ValidationError ? error.data : undefined,
            }),
        };
    }

    if (!("id" in message)) {
        return { notification: message };
    }
    if (Array.isArray(message.params)) {
        return {
            error: errorResponse(message.id, {
                code: JsonRpcErrorCode.InvalidParams,
                message: "Params must be by name, not by position",
                data: { method: message.method },
            }),
        };
    }
    return { request: message };
}

/**
 * Maps an error thrown while executing a handler, most specific first:
 *
 *   - ValidationError to InvalidParams (-32602). It is an AppError, but params failing a method's
 *     schema is exactly the protocol's "invalid params" case, so it takes the specific code and
 *     carries its offending field paths through.
 *   - any other AppError to ApplicationError (-32000), with the error's own code in `data.code`
 *     alongside whatever `data` it already carries. Clients switch on that, not on -32000.
 *   - anything else to InternalError (-32603) with a fixed message: an unexpected error is a bug,
 *     and its message may leak internals, so it never reaches the client.
 *
 * Only errors out of a handler. The envelope-level ones come from {@link parseClientMessage} and
 * the unknown method from the dispatcher, each with its own code and id handling.
 */
export function toJsonRpcError(error: unknown): JsonRpcError {
    if (error instanceof ValidationError) {
        return { code: JsonRpcErrorCode.InvalidParams, message: error.message, data: error.data };
    }
    if (error instanceof AppError) {
        return {
            code: JsonRpcErrorCode.ApplicationError,
            message: error.message,
            data: { ...error.data, code: error.code },
        };
    }
    return { code: JsonRpcErrorCode.InternalError, message: "Internal error" };
}
