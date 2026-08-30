import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { EndpointState } from "@home-chip/contract/endpoint/types.ts";
import type { NodeState } from "@home-chip/contract/node/types.ts";
import { SUBSCRIBE_METHOD } from "@home-chip/contract/snapshot.ts";

import { collectNotifications, connect, opened, request } from "./helpers/client.ts";
import { startBridge, startDevice } from "./helpers/device.ts";
import { startHub } from "./helpers/hub.ts";

/**
 * The hub meeting a real device over the real network: discovery, PASE, the fabric, and the
 * records and events that follow. This is the only place where the pieces the unit suites can
 * only stub — the mDNS scanner, the commissioning flow, the endpoint structure the SDK reports —
 * are exercised against something that actually answers.
 */
/** Matter device type ids, as the contract serves them: a plain number, not an SDK type. */
const ON_OFF_LIGHT = 0x0100;
const AGGREGATOR = 0x000e;

describe("commissioning", () => {
    test("commissions a device from its manual pairing code and announces it", async (t) => {
        const hub = await startHub(t);
        const device = await startDevice(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);
        // Collected from before the subscribe, so an event arriving while it is answered is not
        // missed, and matched by name rather than by being first.
        const notification = collectNotifications(ws);
        await request(ws, SUBSCRIBE_METHOD, undefined, "sub");

        const response = await request(ws, "node.commission", { setupCode: device.manualPairingCode }, "commission");

        assert.ok("result" in response);
        // Discovery, PASE and the fabric join all happened: the hub found the device by the
        // discriminator in that code, which is what the controller's mDNS scanner is for.
        await notification("node:added");
    });

    test("commissions a device from its QR payload", async (t) => {
        // The same device, addressed the other way its label offers. The SDK decodes a manual
        // code itself but reads a QR payload only through its own codec, so this is the path
        // where that branch either works or does not.
        const hub = await startHub(t);
        const device = await startDevice(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);

        const response = await request(ws, "node.commission", { setupCode: device.qrPairingCode });

        assert.ok("result" in response);
    });

    test("records the device's endpoints, the root among none of them", async (t) => {
        const hub = await startHub(t);
        const device = await startDevice(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);
        await request(ws, "node.commission", { setupCode: device.manualPairingCode }, "commission");

        const nodes = await request(ws, "node.list", {}, "nodes");
        const endpoints = await request(ws, "endpoint.list", {}, "endpoints");

        assert.ok("result" in nodes);
        assert.ok("result" in endpoints);
        assert.equal((nodes.result as NodeState[]).length, 1);
        // One endpoint, not two: the root carries only administration clusters and is skipped, so
        // a client is never offered something it cannot control.
        const listed = endpoints.result as EndpointState[];
        assert.equal(listed.length, 1);
        assert.equal(listed[0]?.deviceType, ON_OFF_LIGHT);
    });

    test("records every endpoint a bridge carries, nested ones included", async (t) => {
        // The case a plain device cannot produce. A bridge's lights hang off its aggregator
        // rather than off the root, so a node's direct children are the aggregator alone: reading
        // those reports one endpoint where there are three. Reading the node's whole endpoint
        // index reports the aggregator and both lights, which is what a user has to be able to
        // name and put in a room.
        const hub = await startHub(t);
        const bridge = await startBridge(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);
        await request(ws, "node.commission", { setupCode: bridge.manualPairingCode }, "commission");

        const endpoints = await request(ws, "endpoint.list", {}, "endpoints");

        assert.ok("result" in endpoints);
        const listed = endpoints.result as EndpointState[];
        assert.equal(listed.length, 3);
        // Two of them are the bridged lights; the third is the aggregator itself.
        assert.equal(listed.filter((endpoint) => endpoint.deviceType === ON_OFF_LIGHT).length, 2);
        assert.equal(listed.filter((endpoint) => endpoint.deviceType === AGGREGATOR).length, 1);
    });

    test("turns the light on through the hub, and the device agrees", async (t) => {
        // The full round trip a user makes: a command over JSON-RPC, through the gateway, over
        // Matter, into the device's own state — read here from the device rather than from the
        // hub, so nothing is confirmed by the same code that sent it.
        const hub = await startHub(t);
        const device = await startDevice(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);
        await request(ws, "node.commission", { setupCode: device.manualPairingCode }, "commission");
        const endpoints = await request(ws, "endpoint.list", {}, "endpoints");
        assert.ok("result" in endpoints);
        const endpointId = (endpoints.result as EndpointState[])[0]?.id;

        assert.equal(device.isOn(), false);
        await request(ws, "endpoint.invoke", { id: endpointId, clusterId: 6, commandId: 1 }, "on");

        assert.equal(device.isOn(), true);
    });
});
