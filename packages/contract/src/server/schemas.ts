import * as v from "valibot";

import { parseOrThrow } from "../internal/valibot.ts";

/**
 * The JSON-RPC 2.0 wire envelope: its schemas, the types inferred from them, and one validator
 * per direction.
 *
 *   - `validateClientMessage` for what arrives from a connected client, either a request or a
 *     notification. There are no client-to-server notifications defined, and the server discards
 *     any it receives; accepting them here rather than calling them malformed is what lets a
 *     conforming client fire one without getting back an error response carrying `id: null`,
 *     which it could not correlate with anything.
 *
 *   - `validateServerMessage` for what arrives from the hub, either a response correlated by `id`
 *     or a notification carrying a retransmitted bus event.
 *
 * The asymmetry is the protocol's: a client only invokes operations and wants them confirmed,
 * while the hub both answers operations and pushes state changes. Naming the validators by
 * direction rather than by content keeps that visible at every call site.
 *
 * Per-method params are not this file's business. Each subdomain owns the schemas for its own
 * methods, and the adapter calls those `validate*Params` once the envelope passes here. Result
 * shapes are per-method too, so `result` stays `unknown` in the inferred response types until a
 * client exists to decide how it wants them checked.
 */

// ---------------------------------------------------------------------------
// Private building blocks

/**
 * The spec allows a string, a number or null. We never send `id: null` in a request or a success
 * response, but accept it in an error response, which is what the spec requires when the server
 * could not read the id from the request at all — a parse error, say.
 */
const idSchema = v.union([v.string(), v.number()]);

/**
 * Section 4.2 allows params by position (an array) or by name (an object), and both make a valid
 * Request object, so both are accepted here: this file validates the envelope the spec defines,
 * not the subset this hub serves.
 *
 * Every method here does take params by name, and the adapter turns a positional call away right
 * after parsing, as InvalidParams (-32602) — the parameters are the thing it cannot work with,
 * while the request around them is well formed.
 *
 * Order matters in the union: an array is a valid record with keys "0" and "1" as far as
 * JavaScript is concerned, so with `v.record` first an array would match and be quietly turned
 * into an object.
 */
const paramsSchema = v.union([v.array(v.unknown()), v.record(v.string(), v.unknown())]);

const errorSchema = v.strictObject({
    code: v.number(),
    message: v.string(),
    data: v.optional(v.unknown()),
});

// ---------------------------------------------------------------------------
// Envelope schemas

/**
 * Every envelope is a `v.strictObject`, and here that is load-bearing rather than a preference:
 * members of these unions differ only by which fields are present — a request from a
 * notification by `id`, a success from an error response by `result` against `error`. A
 * non-strict object drops unknown fields silently, so a request whose `id` is malformed would
 * lose it and get promoted to a perfectly valid notification. Rejecting unknown fields keeps the
 * discrimination honest.
 */
const notificationSchema = v.strictObject({
    jsonrpc: v.literal("2.0"),
    method: v.pipe(v.string(), v.minLength(1, "method must not be empty")),
    params: v.optional(paramsSchema),
});

const requestSchema = v.strictObject({
    jsonrpc: v.literal("2.0"),
    method: v.pipe(v.string(), v.minLength(1, "method must not be empty")),
    params: v.optional(paramsSchema),
    id: idSchema,
});

const successResponseSchema = v.strictObject({
    jsonrpc: v.literal("2.0"),
    id: idSchema,
    result: v.unknown(),
});

const errorResponseSchema = v.strictObject({
    jsonrpc: v.literal("2.0"),
    id: v.union([idSchema, v.null()]),
    error: errorSchema,
});

const responseSchema = v.union(
    [successResponseSchema, errorResponseSchema],
    "response must carry either result or error",
);

/**
 * The union messages are spelled out because Valibot's own wording for a failed union reads
 * "Invalid type: Expected Object but received Object", which describes nothing. Where every
 * member fails on the same field — an empty `method`, say — the specific issue still surfaces
 * with its path; these cover the case where the members disagree and the shape as a whole is
 * what is being rejected.
 *
 * A batch, section 6's array of requests, fails here too. This hub does not serve batches, and a
 * single error response is what the spec prescribes when a batch cannot be taken as one.
 */
const clientMessageSchema = v.union(
    [requestSchema, notificationSchema],
    "message must be a JSON-RPC request or notification",
);

const serverMessageSchema = v.union(
    [responseSchema, notificationSchema],
    "message must be a JSON-RPC response or notification",
);

// ---------------------------------------------------------------------------
// Exported types

export type JsonRpcId = v.InferOutput<typeof idSchema>;
export type JsonRpcError = v.InferOutput<typeof errorSchema>;
export type JsonRpcNotification = v.InferOutput<typeof notificationSchema>;
export type JsonRpcRequest = v.InferOutput<typeof requestSchema>;
export type JsonRpcSuccessResponse = v.InferOutput<typeof successResponseSchema>;
export type JsonRpcErrorResponse = v.InferOutput<typeof errorResponseSchema>;
export type JsonRpcResponse = v.InferOutput<typeof responseSchema>;

// ---------------------------------------------------------------------------
// Exported validators

/** Throws ValidationError with structured issues if the message is neither. */
export const validateClientMessage = (input: unknown): JsonRpcRequest | JsonRpcNotification =>
    parseOrThrow(clientMessageSchema, input);

/** Throws ValidationError with structured issues if the message is neither. */
export const validateServerMessage = (input: unknown): JsonRpcResponse | JsonRpcNotification =>
    parseOrThrow(serverMessageSchema, input);
