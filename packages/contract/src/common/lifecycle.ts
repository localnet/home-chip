/**
 * Implemented by every component that owns long-lived resources: database connections, the
 * Matter controller, the WebSocket server, log streams. Stateless components (pure logic,
 * validators, mappers) do not implement it; they are constructed and used directly.
 *
 * The hub composition root drives the whole graph. It constructs each component, starts them
 * in dependency order, and stops the ones that came up in reverse order. Calls are sequential,
 * never concurrent, and every instance serves exactly one run: `start()` is called once, and
 * `stop()` at most once, only after that `start()` resolved. Restarting the hub builds a fresh
 * graph, so no implementation needs to be idempotent or restartable — the hub absorbs repeated
 * `start()` and `stop()` on its own boundary.
 */
export interface Lifecycle {
    /**
     * Acquires resources, opens connections, runs migrations, starts listeners.
     *
     * Throws when the component cannot start (port in use, database locked, missing
     * configuration), and releases whatever it had already acquired before doing so: the hub
     * does not stop a component whose `start()` rejected. The hub treats the error as fatal,
     * unwinds the components already running, and rethrows.
     */
    start(): Promise<void>;

    /**
     * Releases everything acquired during `start()`. Must not throw under normal conditions —
     * shutdown is best-effort — and logs its own failures instead of propagating them.
     */
    stop(): Promise<void>;
}
