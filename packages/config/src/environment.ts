import { homedir } from "node:os";
import { join } from "node:path";

import { ValidationError } from "@home-chip/contract/common/errors.ts";

/**
 * Deployment context resolved from environment variables: where the hub reads its configuration,
 * persists state, writes logs, and the shared secret clients present at the WebSocket handshake.
 *
 * Shares its name with `Environment` from `@matter/main`, but the two never meet: that type never
 * leaves `@home-chip/matter`, the only package depending on the SDK, and this one never leaves
 * config and the composition root.
 */
export interface Environment {
    /**
     * Directory the hub reads its configuration file from. Like `storagePath` and `logPath` it
     * names a deployment root, not a file: the leaf name comes from the component that owns it,
     * so every app under `apps/` shares this one variable and reads its own `<component>.json`
     * from here.
     */
    readonly configPath: string;

    /** Directory where the hub persists state: the database and the Matter fabric storage. */
    readonly storagePath: string;

    /** Directory where log files are written and rotated. */
    readonly logPath: string;

    /** Shared secret clients present at the WebSocket handshake. */
    readonly authToken: string;
}

const TOKEN_VARIABLE = "HOMECHIP_AUTH_TOKEN";

/** Guards against carelessness, not brute force: it makes no claim to cryptographic strength. */
const TOKEN_MIN_LENGTH = 8;

/**
 * An RFC 7230 token. The secret travels as a WebSocket subprotocol, browsers being unable to set
 * headers, so one containing a space or a separator makes `new WebSocket(url, [token])` throw
 * before any request leaves the page. Rejecting it here turns that into a startup failure naming
 * the variable, instead of a connection that fails later for no visible reason.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Reads a variable, treating empty or whitespace-only as unset so `HOMECHIP_LOG_PATH=""` falls
 * back to its default instead of resolving to an empty path. Values are trimmed to strip
 * copy-paste artifacts.
 */
const read = (env: NodeJS.ProcessEnv, name: string): string | undefined => env[name]?.trim() || undefined;

/**
 * Resolves and validates the auth token. The rules live here rather than in the contract's config
 * schemas because this is the only place that knows `HOMECHIP_AUTH_TOKEN` exists: keeping them
 * together lets every failure name that variable in `data`, which a schema validating a bare value
 * cannot do.
 */
function requireAuthToken(env: NodeJS.ProcessEnv): string {
    const token = read(env, TOKEN_VARIABLE);
    const data = { variable: TOKEN_VARIABLE };

    if (token === undefined) {
        throw new ValidationError("Auth token must not be empty", { data });
    }
    if (token.length < TOKEN_MIN_LENGTH) {
        throw new ValidationError(`Auth token must be at least ${TOKEN_MIN_LENGTH} characters`, { data });
    }
    if (!TOKEN_PATTERN.test(token)) {
        throw new ValidationError("Auth token may only contain letters, digits, and - _ . ~ ! # $ % & ' * + ^ | `", {
            data,
        });
    }

    return token;
}

/**
 * Resolves the hub's deployment context from environment variables, falling back to defaults under
 * `~/.home-chip` for everything except `HOMECHIP_AUTH_TOKEN`, which is required: the API grants
 * full control of the home, so refusing to start without a secret is safer than inventing one and
 * printing it somewhere.
 *
 * Resolution only: no directory is created and no file is read. Directory creation belongs to the
 * composition root, file loading to `loadConfig`.
 */
export function resolveEnvironment(env: NodeJS.ProcessEnv = process.env): Environment {
    const defaultRoot = join(homedir(), ".home-chip");

    return {
        configPath: read(env, "HOMECHIP_CONFIG_PATH") ?? defaultRoot,
        storagePath: read(env, "HOMECHIP_STORAGE_PATH") ?? join(defaultRoot, "storage"),
        logPath: read(env, "HOMECHIP_LOG_PATH") ?? join(defaultRoot, "log"),
        authToken: requireAuthToken(env),
    };
}
