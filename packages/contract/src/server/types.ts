/**
 * Error codes this hub puts on the wire: the five JSON-RPC 2.0 standard ones (section 5.1) plus a
 * single implementation-defined code for domain failures.
 *
 * A const object with a derived type rather than a TS `enum`, which `erasableSyntaxOnly` forbids
 * for emitting runtime code.
 *
 * The envelope types themselves — request, notification, responses, error payload, id — live in
 * `schemas.ts`, inferred from their Valibot schemas, since they cross the wire as untrusted input
 * in both directions and gain from one source of truth between validator and type.
 */
export const JsonRpcErrorCode = {
    /** The raw message was not JSON: `JSON.parse` threw before any schema ran. */
    ParseError: -32700,

    /** The JSON parsed but is not a valid JSON-RPC message. */
    InvalidRequest: -32600,

    /** The method named in the request is not registered on this hub. */
    MethodNotFound: -32601,

    /**
     * The params did not pass the method's own schema. Also where a domain `ValidationError`
     * lands, that being exactly this condition detected one layer deeper.
     */
    InvalidParams: -32602,

    /** A handler threw something that is not an `AppError` at all. The last resort. */
    InternalError: -32603,

    /**
     * Every domain `AppError` other than `ValidationError`: not found, conflict, unauthorized,
     * integration, internal. It sits in the implementation-defined range [-32099, -32000] the
     * spec reserves, and the specific failure travels as the error's own machine-readable code in
     * `error.data.code`.
     *
     * One numeric code for all of them, on purpose. Clients switch on `error.data.code`, so
     * minting a number per domain error would duplicate the `AppError.code` taxonomy in a second
     * place that could drift from it; -32000 says only "this is a server-defined application
     * error" to generic JSON-RPC tooling that knows nothing of our domain.
     */
    ApplicationError: -32000,
} as const satisfies Record<string, number>;

export type JsonRpcErrorCode = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];
