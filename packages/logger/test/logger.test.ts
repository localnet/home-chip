import { strict as assert } from "node:assert";
import { Writable } from "node:stream";
import { describe, mock, test } from "node:test";

import { LogLevel } from "@home-chip/contract/logger/types.ts";

import { createLogger } from "../src/logger.ts";

class MemorySink extends Writable {
    readonly lines: string[] = [];

    override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
        this.lines.push(chunk.toString());
        callback();
    }

    /** The single line written so far, failing the test if there is not exactly one. */
    get only(): string {
        assert.equal(this.lines.length, 1, `expected one line, got ${this.lines.length}`);
        return this.lines[0] as string;
    }
}

const PLAIN_LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [A-Z]+ \S+/;

describe("logger", () => {
    describe("createLogger", () => {
        test("writes one line per call: timestamp, level, facility, then the values", () => {
            const withValues = new MemorySink();
            const bare = new MemorySink();

            createLogger(withValues, LogLevel.Debug).info("hello world");
            createLogger(bare, LogLevel.Info).info();

            assert.match(withValues.only, PLAIN_LINE);
            assert.match(withValues.only, / INFO Hub hello world\n$/);
            // No values leaves the line ending at the facility, with no trailing space.
            assert.match(bare.only, / INFO Hub\n$/);
        });

        test("drops everything below the configured level", () => {
            const sink = new MemorySink();
            const logger = createLogger(sink, LogLevel.Warn);

            logger.debug("dropped");
            logger.info("dropped");
            logger.notice("dropped");
            logger.warn("written");
            logger.error("written");
            logger.fatal("written");

            assert.deepEqual(
                sink.lines.map((line) => line.split(" ")[2]),
                ["WARN", "ERROR", "FATAL"],
            );
        });

        test("get() rebinds the facility, keeping the destination and the level", () => {
            const sink = new MemorySink();

            // Facilities do not compose: the innermost name is the whole facility, not "Outer.Inner".
            const child = createLogger(sink, LogLevel.Error).get("Outer").get("Inner");
            child.warn("dropped by the parent's level");
            child.error("written");

            assert.match(sink.only, / ERROR Inner written\n$/);
        });

        test("renders non-strings with inspect, unfolding an Error with its stack", () => {
            const values = new MemorySink();
            const failure = new MemorySink();

            createLogger(values, LogLevel.Info).info("count:", 42, { key: "value" });
            createLogger(failure, LogLevel.Info).error(new Error("boom"));

            assert.match(values.only, / INFO Hub count: 42 \{ key: 'value' \}\n$/);
            assert.match(failure.only, /Error: boom\n\s+at /);
        });

        test("falls back to stderr when the destination throws, without the file's timestamp", () => {
            const broken = new Writable({
                write(): void {
                    throw new Error("destroyed");
                },
            });
            const stderr = mock.method(process.stderr, "write", () => true);

            try {
                createLogger(broken, LogLevel.Info).info("survives");

                assert.equal(stderr.mock.callCount(), 1);
                const written = stderr.mock.calls[0]?.arguments[0] as string;
                assert.match(written, /^home-chip: log write failed, dropping line: /);
                assert.match(written, /INFO Hub survives\n$/);
                // The plain timestamp is absent on purpose: the system logger stamps its own, and
                // two timestamps on one entry read as a bug.
                assert.doesNotMatch(written, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
            } finally {
                stderr.mock.restore();
            }
        });
    });
});
