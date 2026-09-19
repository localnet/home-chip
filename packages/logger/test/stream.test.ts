import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, mock, test } from "node:test";

import { InternalError } from "@home-chip/contract/common/errors.ts";

import { createStreamProvider } from "../src/stream.ts";

const ROTATION = { maxFileSize: "10M", maxFiles: 3 };

const temporaryDirectory = (): string => mkdtempSync(join(tmpdir(), "home-chip-logger-"));

describe("stream", () => {
    describe("createStreamProvider", () => {
        test("start() opens the file and everything written survives stop()", async () => {
            const directory = temporaryDirectory();
            const provider = createStreamProvider(join(directory, "hub.log"), ROTATION);

            await provider.start();
            provider.stream.write("first line\n");
            provider.stream.write("second line\n");
            await provider.stop();

            assert.equal(readFileSync(join(directory, "hub.log"), "utf8"), "first line\nsecond line\n");
        });

        test("an unopenable path fails the start, and leaves nothing behind for a retry", async () => {
            // The failure has to reach the caller: an unusable log path must fail the boot rather
            // than leave the hub writing into nothing. And since start() returns early when a
            // stream is already held, the field is only assigned once the open succeeds, so the
            // retry is a real attempt rather than success reported over a destroyed stream.
            const provider = createStreamProvider("/dev/null/impossible/hub.log", ROTATION);

            await assert.rejects(() => provider.start(), { code: "ENOTDIR" });
            await assert.rejects(() => provider.start(), { code: "ENOTDIR" });
            assert.throws(() => provider.stream, InternalError);
        });

        test("the stream is reachable only between start() and stop()", async () => {
            const provider = createStreamProvider(join(temporaryDirectory(), "hub.log"), ROTATION);

            assert.throws(() => provider.stream, InternalError);

            await provider.start();
            assert.doesNotThrow(() => provider.stream);

            await provider.stop();
            assert.throws(() => provider.stream, InternalError);
        });

        test("absorbs a repeated start or stop, and works again after a restart", async () => {
            const directory = temporaryDirectory();
            const provider = createStreamProvider(join(directory, "hub.log"), ROTATION);

            await provider.stop();
            await provider.start();
            const opened = provider.stream;
            await provider.start();
            // Unguarded, the second start() opens another stream on the same file and the first
            // stays open with nothing left to end it; the log would still read right.
            assert.equal(provider.stream, opened);
            await provider.stop();
            await provider.stop();

            await provider.start();
            provider.stream.write("after the restart\n");
            await provider.stop();

            assert.equal(readFileSync(join(directory, "hub.log"), "utf8"), "after the restart\n");
        });

        test("stop() resolves over a stream a mid-run failure already destroyed", { timeout: 5_000 }, async () => {
            // Destroyed with an error, as a failed write leaves it, end() calls back with
            // ERR_STREAM_DESTROYED. That names the consequence of a failure already reported to
            // stderr, so stop() has nothing to add and a shutdown must not stall or fail on it.
            const provider = createStreamProvider(join(temporaryDirectory(), "hub.log"), ROTATION);
            await provider.start();
            const stderr = mock.method(process.stderr, "write", () => true);

            try {
                const stream = provider.stream;
                const closed = new Promise((resolve) => stream.once("close", resolve));
                stream.destroy(new Error("disk full"));
                await closed;

                await provider.stop();
            } finally {
                stderr.mock.restore();
            }
        });

        test("forwards stream failures after open to stderr instead of crashing", async () => {
            const provider = createStreamProvider(join(temporaryDirectory(), "hub.log"), ROTATION);
            await provider.start();
            const stderr = mock.method(process.stderr, "write", () => true);

            try {
                for (const [event, detail] of [
                    ["error", "disk full"],
                    ["warning", "slow disk"],
                ]) {
                    provider.stream.emit(event as string, new Error(detail as string));
                }

                assert.deepEqual(
                    stderr.mock.calls.map((call) => call.arguments[0]),
                    [
                        'home-chip: log stream "hub.log" error: disk full\n',
                        'home-chip: log stream "hub.log" warning: slow disk\n',
                    ],
                );
            } finally {
                stderr.mock.restore();
                await provider.stop();
            }
        });
    });
});
