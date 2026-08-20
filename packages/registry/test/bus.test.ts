import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { NodeState } from "@home-chip/contract/node/types.ts";

import { createEventBus } from "../src/bus.ts";
import { TestLogger } from "./helpers/logger.ts";

const nodeAdded = (nodeId: string): { node: NodeState; timestamp: number } => ({
    node: { id: nodeId as NodeId, reachable: true },
    timestamp: 0,
});

describe("SyncEventBus", () => {
    describe("emit / on", () => {
        test("hands the payload to every handler of that event, and to no other", () => {
            const bus = createEventBus(new TestLogger());
            const first: unknown[] = [];
            const second: unknown[] = [];
            let otherEvent = 0;
            bus.on("node:added", (payload) => first.push(payload));
            bus.on("node:added", (payload) => second.push(payload));
            bus.on("node:removed", () => otherEvent++);

            const payload = nodeAdded("n1");
            bus.emit("node:added", payload);

            assert.deepEqual(first, [payload]);
            assert.deepEqual(second, [payload]);
            assert.equal(otherEvent, 0);
        });

        test("logs a throwing handler and carries on with the rest", () => {
            const logger = new TestLogger();
            const bus = createEventBus(logger);
            let after = 0;
            bus.on("node:added", () => {
                throw new Error("boom");
            });
            bus.on("node:added", () => after++);

            assert.doesNotThrow(() => bus.emit("node:added", nodeAdded("n1")));

            assert.equal(after, 1);
            assert.equal(
                logger.calls.some((call) => call.level === "error" && call.values[0] === "event handler failed"),
                true,
            );
        });

        test("does not replay past events to a handler subscribed afterwards", () => {
            const bus = createEventBus(new TestLogger());
            bus.emit("node:added", nodeAdded("n1"));

            let calls = 0;
            bus.on("node:added", () => calls++);

            assert.equal(calls, 0);
        });
    });

    describe("unsubscribe", () => {
        test("stops delivery from the next emit on", () => {
            const bus = createEventBus(new TestLogger());
            let calls = 0;
            const unsubscribe = bus.on("node:added", () => calls++);

            bus.emit("node:added", nodeAdded("n1"));
            unsubscribe();
            bus.emit("node:added", nodeAdded("n2"));

            assert.equal(calls, 1);
        });

        test("belongs to its own subscription, not to the handler", () => {
            // The hazard the flag inside on() guards: the same function subscribed again gets a
            // second, independent subscription, and a stale unsubscribe must not take it down.
            const bus = createEventBus(new TestLogger());
            let calls = 0;
            const handler = (): void => {
                calls++;
            };

            const stale = bus.on("node:added", handler);
            stale();
            bus.on("node:added", handler);
            stale();

            bus.emit("node:added", nodeAdded("n1"));
            assert.equal(calls, 1);
        });

        test("a handler unsubscribing itself mid-dispatch leaves the run undisturbed", () => {
            const bus = createEventBus(new TestLogger());
            const order: string[] = [];
            const unsubscribe = bus.on("node:added", () => {
                order.push("first");
                unsubscribe();
            });
            bus.on("node:added", () => order.push("second"));

            bus.emit("node:added", nodeAdded("n1"));
            bus.emit("node:added", nodeAdded("n2"));

            assert.deepEqual(order, ["first", "second", "second"]);
        });

        test("a handler subscribing another mid-dispatch does not have it run for that event", () => {
            // What dispatching over a copy buys: a Set iterator would otherwise visit a handler
            // added while it runs, so the newcomer would see an event it subscribed after.
            const bus = createEventBus(new TestLogger());
            const order: string[] = [];
            bus.on("node:added", () => {
                order.push("first");
                bus.on("node:added", () => order.push("late"));
            });

            bus.emit("node:added", nodeAdded("n1"));
            bus.emit("node:added", nodeAdded("n2"));

            // "late" subscribes twice over the two emits; only the first of those runs here.
            assert.deepEqual(order, ["first", "first", "late"]);
        });
    });
});
