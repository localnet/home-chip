import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";

import type { Environment } from "@home-chip/config/environment.ts";
import type { Lifecycle } from "@home-chip/contract/common/lifecycle.ts";
import { validateConfig } from "@home-chip/contract/config/schemas.ts";

import { createHubProvider } from "../../src/hub.ts";

/** The token every test connects with. These hand the hub a resolved environment directly. */
export const AUTH_TOKEN = "e2e-test-token";

/**
 * A port unlikely to collide on a shared runner. Zero is not an option: the config schema keeps
 * ports at 1024 or above, so a hub cannot ask the OS for a free one.
 *
 * Only one hub may run at a time regardless of this, the Matter controller binding the standard
 * operational port 5540, which is why the e2e script runs its files one at a time.
 */
export const PORT = 18432;

export interface RunningHub {
    readonly url: string;
    readonly environment: Environment;
    /** What hub.log holds so far. Prefer awaitLog for anything the boot has just written. */
    readonly log: () => string;
    /**
     * Waits for a line matching `pattern` to reach hub.log. The stream writes asynchronously, so
     * a line the hub logged a moment ago need not be on disk yet: reading straight after start()
     * races it, and only stop() flushes what is pending.
     */
    readonly awaitLog: (pattern: RegExp) => Promise<string>;
    /** Stops the hub early. Calling it twice is harmless, and so is leaving it to the teardown. */
    readonly stop: () => Promise<void>;
}

/** Long enough for a slow runner's disk, short enough to fail rather than hang the suite. */
const LOG_TIMEOUT_MS = 5_000;

/** A fresh deployment root, so no test inherits another's database or fabric credentials. */
export const freshRoot = (): string => mkdtempSync(join(tmpdir(), "home-chip-e2e-"));

/**
 * Boots a hub and stops it when the test ends, passed or failed: one left running would hold the
 * port and the mDNS socket against every test after it.
 *
 * `root` is taken rather than always minted so a test can boot twice over the same directory,
 * which is what a service manager does on an upgrade.
 */
export async function startHub(t: TestContext, options: { root?: string; port?: number } = {}): Promise<RunningHub> {
    const { root = freshRoot(), port = PORT } = options;
    const environment: Environment = {
        configPath: root,
        storagePath: join(root, "storage"),
        logPath: join(root, "log"),
        authToken: AUTH_TOKEN,
    };
    const hub: Lifecycle = createHubProvider(environment, validateConfig({ server: { port } }));

    await hub.start();
    t.after(() => hub.stop());

    const log = (): string => readFileSync(join(environment.logPath, "hub.log"), "utf8");

    return {
        url: `ws://127.0.0.1:${port}`,
        environment,
        log,
        awaitLog: async (pattern) => {
            const deadline = Date.now() + LOG_TIMEOUT_MS;
            while (Date.now() < deadline) {
                const contents = log();
                if (pattern.test(contents)) {
                    return contents;
                }
                await setTimeout(25);
            }
            throw new Error(`${pattern} never reached hub.log. It holds:\n${log()}`);
        },
        stop: () => hub.stop(),
    };
}
