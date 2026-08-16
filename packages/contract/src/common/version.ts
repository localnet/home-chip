/**
 * Schema version exchanged between client and server during the WebSocket handshake.
 *
 * Bump it on any breaking change to the JSON-RPC protocol: renamed methods, removed methods,
 * changed parameter shapes, changed event payload shapes, renamed error codes. Adding a method
 * or an event does not require a bump — clients that ignore unknown notifications keep working.
 */
export const SCHEMA_VERSION = 1;

/**
 * The server accepts only an exact match, and a client that declared no version at all — the
 * `null` — is one more incompatible client rather than a separate case for the caller to check.
 * Serving older clients with backwards-compatible behaviour would add branching to every
 * handler; while the protocol has no external consumers, the cheaper answer is that a
 * mismatched client updates.
 */
export const isCompatibleSchema = (clientVersion: number | null): boolean => clientVersion === SCHEMA_VERSION;
