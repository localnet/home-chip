import * as v from "valibot";

import { parseOrThrow } from "../internal/valibot.ts";
import { LogLevel } from "../logger/types.ts";

/**
 * The shape of the application configuration file, and its defaults. Reading the file, resolving
 * environment variables and creating directories happen outside: in the config package and in the
 * composition root. Secrets never appear here — the auth token comes from the environment alone,
 * so the file stays safe to commit or share.
 *
 * Every section rejects keys it does not know, unlike the JSON-RPC params schemas. This file has
 * a single author editing it by hand, so a misspelt key is a mistake to report, not a message
 * from a peer to be tolerant of: silently falling back to a default is the one outcome that
 * leaves the operator with no way to tell. The cost is that a config written by a later version
 * stops an earlier one from starting, which is a deliberate act to begin with and reports the
 * offending key by name.
 *
 * Defaults apply per field, not per section: `{ "server": { "port": 9000 } }` leaves
 * `server.host` at its default, and an empty object — for a section or for the whole file —
 * yields a fully defaulted config.
 *
 * The types are inferred from the schemas rather than declared separately. Config is unusual
 * among the subdomains in that the validated value and the schema share their shape exactly, so
 * one source of truth removes any drift between the two.
 */

/**
 * An object that rejects keys it does not know, telling the operator which ones it does take.
 * Valibot's own wording for the case — expected `never` — reads as "delete this line", which is
 * the opposite of what someone who misspelt a key is trying to do.
 *
 * It lists the keys rather than guessing the intended one. The nearest key by edit distance is
 * not reliably the right one: `maxsize` sits closer to `maxFiles` than to `maxFileSize`, so a
 * suggestion would point at a real but wrong field and turn one confusing error into two.
 */
const strictSection = <TEntries extends v.ObjectEntries>(entries: TEntries) =>
    v.strictObject(
        entries,
        (issue) => `unknown key ${issue.received}, expected one of: ${Object.keys(entries).join(", ")}`,
    );

// ---------------------------------------------------------------------------
// server

const serverConfigSchema = strictSection({
    /**
     * Address the JSON-RPC WebSocket listens on. The default accepts connections on every
     * interface, which is what a hub on the LAN wants; `"127.0.0.1"` restricts it to the local
     * machine, and hostnames work too.
     */
    host: v.optional(v.pipe(v.string(), v.minLength(1, "host must not be empty")), "0.0.0.0"),

    /**
     * TCP port for the listener, restricted to the unprivileged range so the hub never needs to
     * run as root.
     */
    port: v.optional(
        v.pipe(
            v.number(),
            v.integer("port must be an integer"),
            v.minValue(1024, "port must be >= 1024"),
            v.maxValue(65535, "port must be <= 65535"),
        ),
        8080,
    ),
});

export type ServerConfig = v.InferOutput<typeof serverConfigSchema>;

// ---------------------------------------------------------------------------
// logger

/**
 * `<integer><unit>`, matching the `FileSize` template type of rotating-file-stream, whose units
 * are exactly B, K, M and G. Validating the form here keeps the JSON honest, since the value
 * reaches the library unparsed.
 */
const FILE_SIZE_PATTERN = /^\d+[BKMG]$/;

const loggerConfigSchema = strictSection({
    /** Minimum severity written to disk; lines below it are dropped silently. */
    level: v.optional(v.picklist(Object.values(LogLevel)), LogLevel.Info),

    /**
     * How large one log file grows before it is rotated. Named for the file rather than for the
     * set, because rotating-file-stream reserves `maxSize` for the total kept across rotations
     * and this is its `size`; next to `maxFiles` the pair reads as how many and how big each.
     */
    maxFileSize: v.optional(
        v.pipe(
            v.string(),
            v.regex(FILE_SIZE_PATTERN, 'maxFileSize must be of the form <integer><B|K|M|G>, e.g. "10M"'),
        ),
        "10M",
    ),

    /** How many rotated files to keep. Older ones are deleted as new rotations happen. */
    maxFiles: v.optional(
        v.pipe(v.number(), v.integer("maxFiles must be an integer"), v.minValue(1, "maxFiles must be >= 1")),
        5,
    ),
});

export type LoggerConfig = v.InferOutput<typeof loggerConfigSchema>;

// ---------------------------------------------------------------------------
// matter

const matterConfigSchema = strictSection({
    /**
     * Network interface the Matter SDK advertises on, such as "eth0" or "wlan0". The default
     * `null` lets matter.js choose, which on Linux means every interface — the usual hub setup.
     */
    networkInterface: v.optional(
        v.union([v.null(), v.pipe(v.string(), v.minLength(1, "networkInterface must not be empty"))]),
        null,
    ),
});

export type MatterConfig = v.InferOutput<typeof matterConfigSchema>;

// ---------------------------------------------------------------------------
// root config

/**
 * The array check runs before the object schema because an array satisfies the object schema on
 * its own — strictness is about unknown keys, not about the container — so without it a JSON file
 * containing `[]` would validate into an all-defaults config instead of being rejected.
 */
const configSchema = v.pipe(
    v.unknown(),
    v.check((input) => !Array.isArray(input), "config must be a JSON object, not an array"),
    strictSection({
        server: v.optional(serverConfigSchema, {}),
        logger: v.optional(loggerConfigSchema, {}),
        matter: v.optional(matterConfigSchema, {}),
    }),
);

export type Config = v.InferOutput<typeof configSchema>;

/**
 * Validates the parsed contents of the config file and returns a fully defaulted `Config`, or
 * throws ValidationError with structured issues. The file must hold a JSON object — `null`, a
 * primitive and an array are all rejected — though an empty one is valid and yields the defaults.
 */
export const validateConfig = (input: unknown): Config => parseOrThrow(configSchema, input);
