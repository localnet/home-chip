/**
 * What a component consumes to write log lines. The composition root hands out a generic
 * `Logger`, and each component names its own facility on construction:
 *
 *     class SomeService {
 *         readonly #logger: Logger;
 *         constructor(deps: { logger: Logger }) {
 *             this.#logger = deps.logger.get("SomeService");
 *         }
 *     }
 *
 * That keeps the facility name where the component is, so renaming or extracting it does not
 * reach into the composition root.
 *
 * Starting the logging stack — opening file streams, configuring rotation, applying the
 * configured level — is deliberately absent from this interface. It belongs to the implementing
 * package's provider, which the composition root builds and drives, so a component holding a
 * `Logger` can log and nothing else.
 *
 * The variadic signature mirrors matter.js, and values render through the same `plain` format the
 * SDK uses, so lines from both sides interleave consistently.
 */
export interface Logger {
    debug(...values: unknown[]): void;
    info(...values: unknown[]): void;
    notice(...values: unknown[]): void;
    warn(...values: unknown[]): void;
    error(...values: unknown[]): void;
    fatal(...values: unknown[]): void;

    /**
     * A logger writing under the given facility. It inherits the destinations, the level and
     * every other behaviour of its parent; only the facility printed on each line changes.
     *
     * Facilities do not compose: `logger.get("X").get("Y")` writes under `"Y"`, not `"X.Y"`.
     * Neither does matter.js have hierarchical facilities, and adding them later would be
     * additive rather than breaking.
     */
    get(facility: string): Logger;
}
