import { ValidationError } from "../common/errors.ts";
import { SCHEMA_VERSION } from "../common/version.ts";

/**
 * The client asked for a schema version this hub does not speak, or asked for none at all.
 * Raised while handling the WebSocket upgrade, before the handshake completes, so the server
 * answers HTTP 426 (Upgrade Required) instead of opening a connection that could only fail.
 *
 * `data` carries both versions so a client can say something actionable — "update the dashboard,
 * the hub speaks schema version 1" — rather than reporting a bare refusal. The expected version
 * is not a constructor argument: it is a fact of the contract, and reading it here spares every
 * caller from passing it in.
 *
 * The only error this subdomain owns. Everything else that can go wrong on a connection is either
 * a domain `AppError` raised further in, or a plain JSON-RPC code the adapter emits from
 * `JsonRpcErrorCode`.
 */
export class SchemaVersionMismatchError extends ValidationError {
    constructor(received: number | null) {
        super(
            received === null
                ? `Missing schema version (expected ${SCHEMA_VERSION})`
                : `Schema version mismatch: expected ${SCHEMA_VERSION}, received ${received}`,
            { data: { expected: SCHEMA_VERSION, received } },
        );
    }
}
