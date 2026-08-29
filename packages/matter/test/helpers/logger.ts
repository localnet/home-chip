import type { Logger } from "@home-chip/contract/logger/ports.ts";

/**
 * Minimal Logger that records calls, so tests can assert on logging without pulling
 * in @home-chip/logger. get() returns the same instance: facility composition is not
 * under test here.
 */
export class TestLogger implements Logger {
    readonly calls: { level: string; values: unknown[] }[] = [];

    debug(...values: unknown[]): void {
        this.calls.push({ level: "debug", values });
    }
    info(...values: unknown[]): void {
        this.calls.push({ level: "info", values });
    }
    notice(...values: unknown[]): void {
        this.calls.push({ level: "notice", values });
    }
    warn(...values: unknown[]): void {
        this.calls.push({ level: "warn", values });
    }
    error(...values: unknown[]): void {
        this.calls.push({ level: "error", values });
    }
    fatal(...values: unknown[]): void {
        this.calls.push({ level: "fatal", values });
    }
    get(): Logger {
        return this;
    }
}
