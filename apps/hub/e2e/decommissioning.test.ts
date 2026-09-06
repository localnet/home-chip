import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { NodeState } from "@home-chip/contract/node/types.ts";
import { SUBSCRIBE_METHOD } from "@home-chip/contract/snapshot.ts";

import { collectNotifications, connect, opened, request } from "./helpers/client.ts";
import { startDevice } from "./helpers/device.ts";
import { startHub } from "./helpers/hub.ts";

/**
 * Undoing a commissioning.
 *
 * Skipped, not removed: the test passes and the process it runs in never exits afterwards, which
 * would hang the suite. The cause is upstream, reported as matter-js/matter.js#4412, and the
 * skip lifts when that closes. It stays in a file of its own so that re-enabling it puts only
 * this at risk — the runner gives each file a process.
 *
 * Everything the hub owns is released: measured at around ten milliseconds, with nothing of the
 * controller, the device or the server left behind. Bisection puts the trigger on the
 * decommission call rather than on the assertions or the pairing that follows.
 */
describe("decommissioning", { skip: "hangs the process: matter-js/matter.js#4412" }, () => {
    test("removes the node, its endpoints, and the fabric the device joined", async (t) => {
        // The inverse of commissioning, and the half no unit suite reaches: those check that we
        // forget the node, never that the device does. Pairing it again is the proof — a device
        // still holding our fabric would refuse, and a user would need a factory reset.
        const hub = await startHub(t);
        const device = await startDevice(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);
        const notification = collectNotifications(ws);
        await request(ws, SUBSCRIBE_METHOD, undefined, "sub");
        const commissioned = await request(ws, "node.commission", { setupCode: device.manualPairingCode }, "first");
        assert.ok("result" in commissioned);
        // The id the hub minted, which is what a client holds a node by.
        const nodeId = commissioned.result as NodeState["id"];

        const removed = await request(ws, "node.decommission", { id: nodeId }, "decommission");

        assert.ok("result" in removed);
        await notification("node:removed");
        const nodes = await request(ws, "node.list", {}, "nodes");
        const endpoints = await request(ws, "endpoint.list", {}, "endpoints");
        assert.ok("result" in nodes);
        assert.ok("result" in endpoints);
        assert.deepEqual(nodes.result, []);
        // Emptied by the database cascade rather than by a second call: deleting the node takes
        // its endpoints with it, which is what lets one removal be reported as one event.
        assert.deepEqual(endpoints.result, []);

        const again = await request(ws, "node.commission", { setupCode: device.manualPairingCode }, "second");
        assert.ok("result" in again);
    });
});
