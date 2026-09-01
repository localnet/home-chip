import type { Writable } from "node:stream";
import { inspect } from "node:util";

import type { Logger } from "@home-chip/contract/logger/ports.ts";
import { LogLevel } from "@home-chip/contract/logger/types.ts";

/**
 * Numeric severity for threshold comparison. The contract keeps levels as strings so they reach
 * matter.js verbatim; filtering needs an order they do not carry.
 */
const SEVERITY = {
    [LogLevel.Debug]: 0,
    [LogLevel.Info]: 1,
    [LogLevel.Notice]: 2,
    [LogLevel.Warn]: 3,
    [LogLevel.Error]: 4,
    [LogLevel.Fatal]: 5,
} as const satisfies Record<LogLevel, number>;

const pad = (value: number, width: number): string => String(value).padStart(width, "0");

/**
 * Strings pass through as written; everything else goes through `util.inspect`, which unfolds an
 * `Error` with its stack. matter.js renders values slightly differently — double-quoted strings
 * inside objects, for one — but the alignment that matters is the line prefix, and both produce
 * that identically.
 */
const render = (value: unknown): string => (typeof value === "string" ? value : inspect(value));

function timestamp(date: Date): string {
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
    const time = `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}`;
    return `${day} ${time}.${pad(date.getMilliseconds(), 3)}`;
}

class PlainLogger implements Logger {
    readonly #stream: Writable;
    readonly #threshold: number;
    readonly #facility: string;

    constructor(stream: Writable, threshold: number, facility: string) {
        this.#stream = stream;
        this.#threshold = threshold;
        this.#facility = facility;
    }

    debug(...values: unknown[]): void {
        this.#write(LogLevel.Debug, values);
    }

    info(...values: unknown[]): void {
        this.#write(LogLevel.Info, values);
    }

    notice(...values: unknown[]): void {
        this.#write(LogLevel.Notice, values);
    }

    warn(...values: unknown[]): void {
        this.#write(LogLevel.Warn, values);
    }

    error(...values: unknown[]): void {
        this.#write(LogLevel.Error, values);
    }

    fatal(...values: unknown[]): void {
        this.#write(LogLevel.Fatal, values);
    }

    get(facility: string): Logger {
        return new PlainLogger(this.#stream, this.#threshold, facility);
    }

    #write(level: LogLevel, values: unknown[]): void {
        if (SEVERITY[level] < this.#threshold) {
            return;
        }
        const message = values.map(render).join(" ");
        const head = `${level.toUpperCase()} ${this.#facility}`;
        const tail = message === "" ? head : `${head} ${message}`;
        try {
            this.#stream.write(`${timestamp(new Date())} ${tail}\n`);
        } catch {
            // Losing a log line must never take the home down with it. A destination that rejects
            // the write synchronously — a destroyed stream, say — leaves stderr, in the shape the
            // system logger expects (`home-chip: <context>: <detail>`) rather than the file's own
            // line, so journald's timestamp is the only one on the entry.
            process.stderr.write(`home-chip: log write failed, dropping line: ${tail}\n`);
        }
    }
}

/**
 * The application `Logger`, writing matter.js-shaped plain lines to `stream`:
 * `YYYY-MM-DD HH:mm:ss.SSS LEVEL Facility values…`, in local time, which is what an operator
 * reading a hub's log on the machine it runs on wants to see.
 *
 * Stateless and outside `Lifecycle`: the stream it writes to is owned by a `StreamProvider`, and
 * a logger that neither opens nor closes anything has nothing to start or stop.
 */
export function createLogger(stream: Writable, level: LogLevel, facility: string = "Hub"): Logger {
    return new PlainLogger(stream, SEVERITY[level], facility);
}
