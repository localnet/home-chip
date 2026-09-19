import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { Environment } from "@home-chip/config/environment.ts";
import { validateConfig } from "@home-chip/contract/config/schemas.ts";

import { createHubProvider } from "../src/hub.ts";

/**
 * These cover the paths of the hub's lifecycle that need no Matter controller: the ones ending
 * before `#boot()` reaches it, the controller needing a network a unit test cannot count on. A
 * boot that succeeds belongs to `npm run e2e`, which runs the bundle as a deployment would.
 *
 * Two decisions of the shutdown are covered by neither: stopping in reverse, the streams last,
 * and carrying on past a stop() that throws. Both need a component this file cannot substitute,
 * the composition root building every one itself.
 */
const root = (): string => mkdtempSync(join(tmpdir(), "home-chip-hub-"));

/** The descriptors this process holds open, which /dev/fd lists on Linux and macOS alike. */
const openDescriptors = (): number => readdirSync("/dev/fd").length;

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
        const descriptors = openDescriptors();

        await assert.rejects(() => hub.start());

        assert.match(readFileSync(join(environment.logPath, "hub.log"), "utf8"), /ERROR Hub failed to start/);
        // Each stream holds its file open until its stop() ends it, so the count coming back to
        // where it started is the unwind having reached them: without it, two log files stay open
        // for the life of the process.
        assert.equal(openDescriptors(), descriptors);
        // The unwind is what emptied #started: left populated, the guard would latch and this
        // second attempt would resolve, reporting success for a hub that never booted.
        await assert.rejects(() => hub.start());
    });
});
