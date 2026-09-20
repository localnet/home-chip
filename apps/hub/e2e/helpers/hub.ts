import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type { Environment } from "@home-chip/config/environment.ts";

export interface RunningHub {
    readonly url: string;
    readonly environment: Environment;
    /**
     * What hub.log holds so far, this hub's boot and any before it on the same directory. Prefer
     * awaitLog for anything the boot has just written.
     */
    readonly log: () => string;
    /**
     * Waits for a line matching `pattern` to reach hub.log, among what this hub wrote: a restart
     * reuses the file, and the boot before it is not what a wait is asking about. The stream
     * writes asynchronously, so a line the hub logged a moment ago need not be on disk yet:
     * reading straight after the boot races it, and only the shutdown flushes what is pending.
     */
    readonly awaitLog: (pattern: RegExp) => Promise<string>;
    /**
     * Stops the hub early, failing unless it exits with 0 within STOP_TIMEOUT_MS of the signal.
     * Calling it twice is harmless, and so is leaving it to the teardown.
     */
    readonly stop: () => Promise<void>;
}

interface Exit {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
}

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

/**
 * The built entry. Nothing rebuilds it before a run, so build first: a stale one is tested
 * without a word, sources and bundle disagreeing.
 */
const BUNDLE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "main.js");

/**
 * The installed command to run instead of the bundle, when set. CI sets it to the `home-chip`
 * command of the package installed globally outside the repository, which covers what dist/
 * cannot: run
 * from there, the bundle resolves every third-party import from the workspace's node_modules,
 * so a dependency the generated manifest lacks goes unnoticed, and the `bin` link and its shebang
 * are never used. Outside the HOMECHIP_ names on purpose, those being the hub's own configuration.
 */
const INSTALLED = process.env.E2E_HUB_BIN;

/** What startHub spawns: the installed command as a host runs it, or the bundle under this Node. */
const COMMAND: readonly [string, ...string[]] = (() => {
    if (INSTALLED === undefined || INSTALLED === "") {
        return [process.execPath, BUNDLE];
    }
    const bin = resolve(INSTALLED);
    // Checked here rather than left to spawn, whose ENOENT would name neither the variable nor
    // what it pointed at, and would surface as every test's hub failing to start.
    if (!existsSync(bin)) {
        throw new Error(`E2E_HUB_BIN points at ${bin}, which does not exist`);
    }
    return [bin];
})();

/** Long enough for a slow runner's disk, short enough to fail rather than hang the suite. */
const LOG_TIMEOUT_MS = 15_000;

/**
 * How long the hub has to exit once signalled. A clean stop takes milliseconds, idle or with a
 * peer connected, so this is slack for a slow runner rather than an estimate: what it bounds is a
 * shutdown that never ends, which would otherwise hold the suite until CI kills the job, with
 * nothing said about which hub or why.
 */
const STOP_TIMEOUT_MS = 10_000;

/** How much of hub.log a failed stop quotes: enough to show which component was still stopping. */
const LOG_TAIL_LINES = 20;

const describeExit = ({ code, signal }: Exit): string => (signal !== null ? `signal ${signal}` : `code ${code}`);

const tail = (text: string, lines: number): string => text.split("\n").slice(-lines).join("\n");

/** A fresh deployment root, so no test inherits another's database or fabric credentials. */
export const freshRoot = (): string => mkdtempSync(join(tmpdir(), "home-chip-e2e-"));

/**
 * Boots a hub and stops it when the test ends, passed or failed: one left running would hold the
 * port and the mDNS socket against every test after it.
 *
 * The hub runs as its own process, started the way a deployment does — an environment, a config
 * file, a signal to stop. Nothing here reaches into `src`, so what these tests exercise includes
 * the entry point and the build: an entry that no longer resolves its environment fails here
 * rather than on a target host. Run against an installed package (see INSTALLED), they exercise
 * its manifest too.
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

    // The port travels in the config file rather than the environment, which is where a
    // deployment would put it and the only way to say it to a process we do not construct.
    writeFileSync(join(root, "hub.json"), JSON.stringify({ server: { port } }));

    const logFile = join(environment.logPath, "hub.log");
    // What the file already holds, measured before this hub can write a byte. A restart reuses
    // the directory, so the previous hub's "ready" is sitting there, and awaitLog matching it
    // would hand back a hub that is not listening yet — which is what a client then meets as a
    // refused upgrade.
    const written = existsSync(logFile) ? statSync(logFile).size : 0;

    const [command, ...args] = COMMAND;
    const hub = spawn(command, args, {
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

    const log = (): string => {
        try {
            return readFileSync(logFile, "utf8");
        } catch {
            return "";
        }
    };

    /** What this hub wrote, which is what a wait on the log is asking about. */
    const logSinceStart = (): string => log().slice(written);

    const exited = new Promise<Exit>((resolve) => hub.once("exit", (code, signal) => resolve({ code, signal })));
    const hasExited = (): boolean => hub.exitCode !== null || hub.signalCode !== null;

    // Set once awaitLog has reported an exit, so the teardown does not report the same one again.
    let exitReported = false;

    /**
     * The shutdown is part of what the tests check, not only their cleanup: a service manager
     * reads a non-zero code as a failure and, under a restart policy, brings back a hub the
     * operator just stopped, and one that never exits gets killed at the end of its timeout.
     */
    const shutdown = async (): Promise<void> => {
        const running = !hasExited();
        if (running) {
            // The signal a service manager sends, so the shutdown under test is the real one.
            hub.kill("SIGTERM");
        }

        let timer: NodeJS.Timeout | undefined;
        const deadline = new Promise<"timeout">((resolve) => {
            timer = globalThis.setTimeout(() => resolve("timeout"), STOP_TIMEOUT_MS);
        });
        const outcome = await Promise.race([exited, deadline]);
        globalThis.clearTimeout(timer);

        if (outcome === "timeout") {
            // Killed so the port and the mDNS socket are free for the tests that follow, which
            // would otherwise fail on this hub's account.
            hub.kill("SIGKILL");
            await exited;
            throw new Error(
                `the hub did not exit within ${STOP_TIMEOUT_MS}ms of SIGTERM and was killed. The end of hub.log:\n${tail(log(), LOG_TAIL_LINES)}\nand the process said:\n${output}`,
            );
        }
        if (!running) {
            if (exitReported) {
                return;
            }
            throw new Error(`the hub exited on its own with ${describeExit(outcome)}, unasked:\n${output}`);
        }
        if (outcome.code !== 0) {
            throw new Error(`the hub stopped with ${describeExit(outcome)} rather than 0:\n${output}`);
        }
    };
    let stopping: Promise<void> | undefined;
    const stop = (): Promise<void> => {
        stopping ??= shutdown();
        return stopping;
    };
    t.after(stop);

    const awaitLog = async (pattern: RegExp): Promise<string> => {
        const deadline = Date.now() + LOG_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const contents = logSinceStart();
            if (pattern.test(contents)) {
                return contents;
            }
            // Either field, since a hub killed by a signal leaves exitCode null: checking the code
            // alone would wait out the timeout and then blame the log.
            if (hasExited()) {
                exitReported = true;
                throw new Error(
                    `the hub exited with ${describeExit({ code: hub.exitCode, signal: hub.signalCode })} before ${pattern}:\n${output}`,
                );
            }
            await setTimeout(25);
        }
        throw new Error(
            `${pattern} never reached hub.log. This hub wrote:\n${logSinceStart()}\nand the process said:\n${output}`,
        );
    };

    await awaitLog(/NOTICE Hub ready/);

    return { url: `ws://127.0.0.1:${port}`, environment, log, awaitLog, stop };
}
