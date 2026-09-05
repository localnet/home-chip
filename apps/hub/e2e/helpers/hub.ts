import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type { Environment } from "@home-chip/config/environment.ts";

import { LOOPBACK } from "./loopback.ts";

/** The token every test connects with, passed the way the entry point reads it. */
export const AUTH_TOKEN = "e2e-test-token";

/**
 * A port unlikely to collide on a shared runner. Zero is not an option: the config schema keeps
 * ports at 1024 or above, so a hub cannot ask the OS for a free one.
 *
 * Only one hub may run at a time regardless of this, the Matter controller binding the standard
 * operational port 5540, which is why the e2e script runs its files one at a time.
 */
export const PORT = 18432;

/** The built entry, which is what these tests run: the artefact, not the sources behind it. */
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "main.js");

export interface RunningHub {
    readonly url: string;
    readonly environment: Environment;
    /** What hub.log holds so far. Prefer awaitLog for anything the boot has just written. */
    readonly log: () => string;
    /**
     * Waits for a line matching `pattern` to reach hub.log. The stream writes asynchronously, so
     * a line the hub logged a moment ago need not be on disk yet: reading straight after the boot
     * races it, and only the shutdown flushes what is pending.
     */
    readonly awaitLog: (pattern: RegExp) => Promise<string>;
    /** Stops the hub early. Calling it twice is harmless, and so is leaving it to the teardown. */
    readonly stop: () => Promise<void>;
}

/** Long enough for a slow runner's disk, short enough to fail rather than hang the suite. */
const LOG_TIMEOUT_MS = 15_000;

/** A fresh deployment root, so no test inherits another's database or fabric credentials. */
export const freshRoot = (): string => mkdtempSync(join(tmpdir(), "home-chip-e2e-"));

/**
 * Boots a hub and stops it when the test ends, passed or failed: one left running would hold the
 * port and the mDNS socket against every test after it.
 *
 * The hub runs as its own process, started from the bundle the way a deployment does — an
 * environment, a config file, a signal to stop. Nothing here reaches into `src`, so what these
 * tests exercise includes the entry point and the build: a chunk that stopped being emitted, or
 * an entry that no longer resolves its environment, fails here rather than on a target host.
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

    // The config file rather than the environment: it is where a deployment puts these, and the
    // only way to say them to a process we do not construct. The interface confines the hub to
    // the loopback, as the device helper confines the devices, so a run stays on this host.
    writeFileSync(join(root, "hub.json"), JSON.stringify({ server: { port }, matter: { networkInterface: LOOPBACK } }));

    const hub = spawn(process.execPath, [BUNDLE], {
        env: {
            ...process.env,
            HOMECHIP_CONFIG_PATH: environment.configPath,
            HOMECHIP_STORAGE_PATH: environment.storagePath,
            HOMECHIP_LOG_PATH: environment.logPath,
            HOMECHIP_AUTH_TOKEN: environment.authToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    // Kept for the failure message below: a hub that never reaches ready has usually said why on
    // stderr, and without this the test would report only that a log line failed to appear.
    let output = "";
    hub.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
    });
    hub.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
    });

    const exited = new Promise<void>((resolve) => hub.once("exit", () => resolve()));
    const stop = async (): Promise<void> => {
        if (hub.exitCode === null && hub.signalCode === null) {
            // The signal a service manager sends, so the shutdown under test is the real one.
            hub.kill("SIGTERM");
        }
        await exited;
    };
    t.after(stop);

    const logFile = join(environment.logPath, "hub.log");
    const log = (): string => {
        try {
            return readFileSync(logFile, "utf8");
        } catch {
            return "";
        }
    };

    const awaitLog = async (pattern: RegExp): Promise<string> => {
        const deadline = Date.now() + LOG_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const contents = log();
            if (pattern.test(contents)) {
                return contents;
            }
            if (hub.exitCode !== null) {
                throw new Error(`the hub exited with ${hub.exitCode} before ${pattern}:\n${output}`);
            }
            await setTimeout(25);
        }
        throw new Error(`${pattern} never reached hub.log. It holds:\n${log()}\nand the process said:\n${output}`);
    };

    await awaitLog(/NOTICE Hub ready/);

    return { url: `ws://127.0.0.1:${port}`, environment, log, awaitLog, stop };
}
