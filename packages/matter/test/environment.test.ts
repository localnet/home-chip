// Must precede any "@matter/main" import: see sdk-config.ts
import "../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, test } from "node:test";

import { LogLevel } from "@home-chip/contract/logger/types.ts";

import { configureEnvironment } from "../src/environment.ts";

class MemorySink extends Writable {
    readonly chunks: string[] = [];
    override _write(chunk: Buffer, _enc: string, cb: () => void): void {
        this.chunks.push(chunk.toString());
        cb();
    }
}

function rootPath(): string {
    return join(mkdtempSync(join(tmpdir(), "home-chip-matter-")), "matter");
}

describe("environment", () => {
    describe("configureEnvironment", () => {
        test("sets our storage path on the SDK environment", () => {
            const path = rootPath();
            const environment = configureEnvironment(path, new MemorySink(), {
                networkInterface: null,
                logLevel: LogLevel.Info,
            });
            assert.equal(environment.vars.get("storage.path"), path);
        });

        test("binds mDNS to the configured network interface", () => {
            const environment = configureEnvironment(rootPath(), new MemorySink(), {
                networkInterface: "wlan0",
                logLevel: LogLevel.Info,
            });
            assert.equal(environment.vars.get("mdns.networkInterface"), "wlan0");
        });

        test("redirects the SDK logger output to the provided stream", async () => {
            const sink = new MemorySink();
            configureEnvironment(rootPath(), sink, { networkInterface: null, logLevel: LogLevel.Info });
            // Drive the SDK logger and confirm the line lands in our stream.
            const { Logger } = await import("@matter/main");
            Logger.get("ProbeFacility").info("hello from sdk");
            assert.equal(sink.chunks.length, 1);
            assert.match(sink.chunks[0] as string, /INFO ProbeFacility hello from sdk\n$/);
        });

        test("does not leak MATTER_* environment variables into the SDK", async () => {
            // sdk-config.ts sets loadProcessEnv=false; a MATTER_* var in the process
            // must not override our explicit storage path.
            process.env.MATTER_STORAGE_PATH = "/tmp/should-not-be-used-by-sdk";
            try {
                const path = rootPath();
                const environment = configureEnvironment(path, new MemorySink(), {
                    networkInterface: null,
                    logLevel: LogLevel.Info,
                });
                assert.equal(environment.vars.get("storage.path"), path);
                assert.notEqual(environment.vars.get("storage.path"), "/tmp/should-not-be-used-by-sdk");
            } finally {
                delete process.env.MATTER_STORAGE_PATH;
            }
        });
    });
});
