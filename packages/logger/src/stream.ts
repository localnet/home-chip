import { basename, dirname } from "node:path";
import type { Writable } from "node:stream";

import { InternalError } from "@home-chip/contract/common/errors.ts";
import type { Lifecycle } from "@home-chip/contract/common/lifecycle.ts";
import type { LoggerConfig } from "@home-chip/contract/config/schemas.ts";
import { createStream, type RotatingFileStream } from "rotating-file-stream";

/**
 * Owns one rotated file and exposes it as a writable stream. The composition root creates one per
 * file — `hub.log` for the application logger, `matter/hub.log` for the SDK — starts them before
 * anything that writes, and stops them last, so every other component can still log while it shuts
 * down. Content-agnostic: it neither formats nor inspects what goes through it.
 */
export interface StreamProvider extends Lifecycle {
    /**
     * The writable destination, available only between `start()` and `stop()`. Reaching for it
     * outside that window is a wiring bug in the composition root and throws `InternalError`.
     */
    readonly stream: Writable;
}

/** Rotation policy, taken verbatim from the logger section of the config. */
export type RotationOptions = Pick<LoggerConfig, "maxFileSize" | "maxFiles">;

class RotatingStreamProvider implements StreamProvider {
    readonly #directory: string;
    readonly #fileName: string;
    readonly #options: RotationOptions;
    #stream: RotatingFileStream | undefined;

    constructor(filePath: string, options: RotationOptions) {
        this.#directory = dirname(filePath);
        this.#fileName = basename(filePath);
        this.#options = options;
    }

    get stream(): Writable {
        if (this.#stream === undefined) {
            throw new InternalError(`Log stream "${this.#fileName}" accessed outside its start()/stop() window`);
        }
        return this.#stream;
    }

    async start(): Promise<void> {
        if (this.#stream !== undefined) {
            return;
        }
        const stream = createStream(this.#fileName, {
            path: this.#directory,
            size: this.#options.maxFileSize,
            maxFiles: this.#options.maxFiles,
        });

        // The file opens asynchronously, so an unusable path would otherwise surface long after
        // boot with the hub already writing into nothing. Waiting turns it into a failed start.
        //
        // The rejection is what makes that work: a failed open emits `error` and never `open`, so
        // without it the promise would never settle and the hub would hang with nothing to report.
        // It also needs rotating-file-stream 3.2.10 or later, where that `error` arrives without
        // waiting for a write — hence the floor in package.json. The stream destroys itself as it
        // emits, so there is nothing to release here, and `reject` is left attached afterwards
        // because settling twice is a no-op that the first error clears.
        await new Promise<void>((resolve, reject) => {
            stream.once("open", () => resolve());
            stream.once("error", (error) => reject(error));
        });

        // Failures from here on — disk full, permissions revoked mid-run — go to stderr for the
        // system logger to pick up: losing log lines beats losing the home. Attached after the
        // open so a failed open is reported once, as a failed start, and not twice.
        stream.on("error", (error: Error) => {
            process.stderr.write(`home-chip: log stream "${this.#fileName}" error: ${error.message}\n`);
        });
        stream.on("warning", (warning: Error) => {
            process.stderr.write(`home-chip: log stream "${this.#fileName}" warning: ${warning.message}\n`);
        });

        // Assigned last: a start that failed leaves the field empty, so the guard above lets a
        // retry build a fresh stream instead of reporting success over a destroyed one.
        this.#stream = stream;
    }

    async stop(): Promise<void> {
        if (this.#stream === undefined) {
            return;
        }
        const stream = this.#stream;

        // Released before the teardown, not after: the field says the stream is usable, and from
        // here it is not. Reaching for it now gets the window error, which is accurate.
        this.#stream = undefined;

        // Awaited so the pending tail reaches disk before the process moves on.
        await new Promise<void>((resolve) => {
            stream.end(() => resolve());
        });
    }
}

/**
 * A `StreamProvider` for the file at `filePath`, rotating per `options`. Takes the whole path and
 * splits it internally, since rotating-file-stream wants directory and file name apart and a
 * caller handed two strings can transpose them.
 */
export function createStreamProvider(filePath: string, options: RotationOptions): StreamProvider {
    return new RotatingStreamProvider(filePath, options);
}
