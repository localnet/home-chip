import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { NodeState } from "@home-chip/contract/node/types.ts";
import { SUBSCRIBE_METHOD } from "@home-chip/contract/snapshot.ts";

import { call, collectNotifications, connect, opened } from "./helpers/client.ts";
import { startDevice } from "./helpers/device.ts";
import { startHub } from "./helpers/hub.ts";

/**
 * Undoing a commissioning.
 *
 * The device's side of it leaks until the SDK pin includes matter-js/matter.js#4436: losing our
 * fabric factory-resets the simulated device, which leaves a share of the process-wide mDNS
 * service that nothing closes, so the test process never exits on its own
 * (matter-js/matter.js#4412). The test itself passes; the e2e script's --test-force-exit is what
 * ends the process once it has. The hub's side is not excused: its exit is checked like every
 * other hub's.
 *
 * It stays in a file of its own because the runner gives each file a process, so the leaked share
 * cannot reach another file's devices.
 */
describe("decommissioning", () => {
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
        await call(ws, SUBSCRIBE_METHOD, undefined, "sub");
        // The id the hub minted, which is what a client holds a node by.
        const nodeId = (await call(
            ws,
            "node.commission",
            { setupCode: device.manualPairingCode },
            "first",
        )) as NodeState["id"];

        await call(ws, "node.decommission", { id: nodeId }, "decommission");

        await notification("node:removed");
        assert.deepEqual(await call(ws, "node.list", {}, "nodes"), []);
        // Emptied by the database cascade rather than by a second call: deleting the node takes
        // its endpoints with it, which is what lets one removal be reported as one event.
        assert.deepEqual(await call(ws, "endpoint.list", {}, "endpoints"), []);

        // Pairing it again is the proof; a device still holding our fabric would refuse, and call
        // throws with the hub's answer.
        await call(ws, "node.commission", { setupCode: device.manualPairingCode }, "second");
    });
});
