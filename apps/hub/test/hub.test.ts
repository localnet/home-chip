import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { Environment } from "@home-chip/config/environment.ts";
import { validateConfig } from "@home-chip/contract/config/schemas.ts";

import { createHubProvider } from "../src/hub.ts";

/**
 * These cover the paths of the hub's lifecycle that need no Matter controller: the ones ending
 * before `#boot()` reaches it. Starting successfully requires mDNS over multicast, which CI
 * runners do not provide, so the happy path stays a manual smoke test against real hardware —
 * the same split matterjs-server settled on, running its full-boot suite in a separate Docker
 * job rather than alongside the unit tests.
 */
const root = (): string => mkdtempSync(join(tmpdir(), "home-chip-hub-"));

const environment = (directory: string): Environment => ({
    configPath: directory,
    storagePath: join(directory, "storage"),
    logPath: join(directory, "log"),
    authToken: "test-token",
});

/** An environment whose storagePath sits under a regular file, so mkdir fails with ENOTDIR. */
const unwritableEnvironment = (): Environment => {
    const directory = root();
    const blocker = join(directory, "blocker");
    writeFileSync(blocker, "");
    return { ...environment(directory), storagePath: join(blocker, "storage") };
};

/** An environment where the paths are fine but hub.db is a directory, so SQLite cannot open it. */
const unopenableDatabase = (): Environment => {
    const directory = root();
    mkdirSync(join(directory, "storage"), { recursive: true });
    mkdirSync(join(directory, "storage", "hub.db"));
    return environment(directory);
};

describe("createHubProvider", () => {
    test("stop() before start() is a no-op", async () => {
        const hub = createHubProvider(environment(root()), validateConfig({}));

        // Nothing started, so #shutdown() walks an empty list. It must not reject: the entry
        // point calls stop() from its signal handlers however far start() got.
        await assert.doesNotReject(() => hub.stop());
    });

    test("a boot that cannot create its paths fails, stays unstarted, and can be tried again", async () => {
        const hub = createHubProvider(unwritableEnvironment(), validateConfig({}));

        // The code is asserted so the test cannot pass for the wrong reason: a failure later in
        // #boot() would be a different error entirely.
        await assert.rejects(
            () => hub.start(),
            (error: unknown) => {
                assert.equal((error as NodeJS.ErrnoException).code, "ENOTDIR");
                return true;
            },
        );

        // #started stayed empty, so the guard must not latch: stop() is still a no-op and a
        // second start() has to attempt the boot rather than report success by skipping it.
        await assert.doesNotReject(() => hub.stop());
        await assert.rejects(() => hub.start());
    });

    test("a boot that fails after the logs are open records why, then unwinds", async () => {
        // Far enough in to have started both stream providers, which is what makes this the path
        // that exercises the unwind, where the mkdir failure above starts nothing at all.
        const environment = unopenableDatabase();
        const hub = createHubProvider(environment, validateConfig({}));

        await assert.rejects(() => hub.start());

        assert.match(readFileSync(join(environment.logPath, "hub.log"), "utf8"), /ERROR Hub failed to start/);
        // The unwind is what emptied #started: left populated, the guard would latch and this
        // second attempt would resolve, reporting success for a hub that never booted.
        await assert.rejects(() => hub.start());
    });
});
