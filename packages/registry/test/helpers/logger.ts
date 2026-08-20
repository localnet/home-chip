import type { Logger } from "@home-chip/contract/logger/ports.ts";

/**
 * A Logger that records what it was told, so a test can assert on logging without pulling in
 * @home-chip/logger. Two tests read `calls`: the bus logging a handler that threw, and the
 * endpoint view warning about one it had to skip. The rest only need somewhere for the lines to
 * go.
 *
 * `get()` returns the same instance: which facility a line went under is the logger package's
 * business, not something to assert on here.
 */
export class TestLogger implements Logger {
    readonly calls: { level: string; values: unknown[] }[] = [];

    debug(...values: unknown[]): void {
        this.#record("debug", values);
    }

    info(...values: unknown[]): void {
        this.#record("info", values);
    }

    notice(...values: unknown[]): void {
        this.#record("notice", values);
    }

    warn(...values: unknown[]): void {
        this.#record("warn", values);
    }

    error(...values: unknown[]): void {
        this.#record("error", values);
    }

    fatal(...values: unknown[]): void {
        this.#record("fatal", values);
    }

    get(): Logger {
        return this;
    }

    #record(level: string, values: unknown[]): void {
        this.calls.push({ level, values });
    }
}
