/**
 * Extends the standard `ErrorOptions` interface (which carries `cause`) with `data` for
 * structured, client-safe detail.
 */
interface AppErrorOptions extends ErrorOptions {
    data?: Readonly<Record<string, unknown>>;
}

/**
 * Base class for every error thrown across HomeChip packages. The server maps `code` to a
 * JSON-RPC error code and sends `code`, `message` and `data` to the client; `cause` never
 * crosses the wire, as it can leak internal detail.
 */
export abstract class AppError extends Error {
    /**
     * Stable, machine-readable identifier: the subclass name in SCREAMING_SNAKE_CASE. Clients
     * switch on this, not on the human-readable `message`. The subclasses below fix the whole
     * set: subdomain errors extend one of them and inherit its code, telling their cases apart
     * through `data` rather than multiplying codes.
     */
    abstract readonly code: string;

    /** Structured detail safe to expose to clients. Must be JSON-serializable. */
    readonly data?: Readonly<Record<string, unknown>>;

    constructor(message: string, options?: AppErrorOptions) {
        super(message, options);
        this.name = this.constructor.name;
        this.data = options?.data;
    }
}

/**
 * The input failed validation: malformed JSON-RPC params, schema mismatch, invalid setup
 * code format. Always caused by the client; retrying the same input cannot help.
 */
export class ValidationError extends AppError {
    readonly code = "VALIDATION_ERROR";
}

/**
 * The requested resource does not exist: node, endpoint, room, attribute. The `data` field
 * carries the identifier that was not found.
 */
export class NotFoundError extends AppError {
    readonly code = "NOT_FOUND_ERROR";
}

/**
 * The operation contradicts current state: commissioning a device that is already paired,
 * deleting a room that still has endpoints assigned.
 */
export class ConflictError extends AppError {
    readonly code = "CONFLICT_ERROR";
}

/**
 * The caller is not authenticated or its token is invalid. There is no authorization model
 * yet, so there is no separate "authenticated but not allowed" error to confuse it with.
 */
export class UnauthorizedError extends AppError {
    readonly code = "UNAUTHORIZED_ERROR";
}

/**
 * An external system failed: the Matter SDK rejected a command, SQLite returned an I/O
 * error, the network is unreachable. The `cause` field keeps the original error for the
 * log; `data` may carry sanitized context for the client.
 */
export class IntegrationError extends AppError {
    readonly code = "INTEGRATION_ERROR";
}

/**
 * The target could not be reached, so the request never arrived — a sleeping or offline
 * device. Transient and retryable, unlike a failure (something broke) or a rejection (the
 * target received the request and refused it), so clients should surface it as "will retry
 * when reachable" rather than a hard failure. The subclass and `data` carry the reason.
 */
export class UnreachableError extends AppError {
    readonly code = "UNREACHABLE_ERROR";
}

/**
 * Catch-all for unexpected internal failures: bugs, invariant violations, unknown states.
 * Should never appear in normal operation.
 */
export class InternalError extends AppError {
    readonly code = "INTERNAL_ERROR";
}
