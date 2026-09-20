import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { EndpointState } from "@home-chip/contract/endpoint/types.ts";
import type { NodeInfo, NodeState } from "@home-chip/contract/node/types.ts";
import { SUBSCRIBE_METHOD } from "@home-chip/contract/snapshot.ts";

import { call, collectNotifications, connect, opened } from "./helpers/client.ts";
import { startBridge, startDevice } from "./helpers/device.ts";
import { freshRoot, startHub } from "./helpers/hub.ts";

/**
 * The hub meeting a real device over the real network: discovery, PASE, the fabric, and the
 * records and events that follow. This is the only place where the pieces the unit suites can
 * only stub — the mDNS scanner, the commissioning flow, the endpoint structure the SDK reports —
 * are exercised against something that actually answers.
 */
/** Matter device type ids, as the contract serves them: a plain number, not an SDK type. */
const ON_OFF_LIGHT = 0x0100;
const AGGREGATOR = 0x000e;

/** The cluster and attribute a light reports its own state through. */
const ON_OFF_CLUSTER = 0x0006;
const ON_OFF_ATTRIBUTE = 0x0000;

/** The OnOff cluster's On command. */
const ON_COMMAND = 0x01;

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
        await call(ws, SUBSCRIBE_METHOD, undefined, "sub");

        await call(ws, "node.commission", { setupCode: device.manualPairingCode }, "commission");

        // Discovery, PASE and the fabric join all happened: the hub found the device by the
        // discriminator in that code, which is what the controller's mDNS scanner is for.
        await notification("node:added");
    });

    test("commissions a device from its QR payload", async (t) => {
        // The same device, addressed the other way its label offers, and found another way: a
        // manual code carries only the 4-bit short discriminator, a QR payload the full 12 bits,
        // which the SDK searches for as the long one. Decoding the payload is unit-tested; this is
        // the only place a device is discovered by the long discriminator over real mDNS.
        const hub = await startHub(t);
        const device = await startDevice(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);

        await call(ws, "node.commission", { setupCode: device.qrPairingCode });
    });

    test("records the device's endpoints, the root among none of them", async (t) => {
        const hub = await startHub(t);
        const device = await startDevice(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);
        await call(ws, "node.commission", { setupCode: device.manualPairingCode }, "commission");

        const nodes = (await call(ws, "node.list", {}, "nodes")) as NodeState[];
        const endpoints = (await call(ws, "endpoint.list", {}, "endpoints")) as EndpointState[];

        assert.equal(nodes.length, 1);
        // One endpoint, not two: the root carries only administration clusters and is skipped, so
        // a client is never offered something it cannot control. Compared as the list of device
        // types, so a wrong count shows which endpoints did come back.
        assert.deepEqual(
            endpoints.map((endpoint) => endpoint.deviceType),
            [ON_OFF_LIGHT],
        );
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
        await call(ws, "node.commission", { setupCode: bridge.manualPairingCode }, "commission");

        const endpoints = (await call(ws, "endpoint.list", {}, "endpoints")) as EndpointState[];

        // Two of them are the bridged lights; the third is the aggregator itself. Sorted because
        // the list is ordered by endpoint number, which the SDK assigns as the bridge is built,
        // not this test.
        assert.deepEqual(
            endpoints.map((endpoint) => endpoint.deviceType).sort((a, b) => a - b),
            [AGGREGATOR, ON_OFF_LIGHT, ON_OFF_LIGHT],
        );
    });

    test("a change made at the device reaches a subscribed client", async (t) => {
        // The direction the hub exists for, and the one no other test covers: the device changes
        // on its own — a wall switch, not a command — and the change has to travel the whole way
        // back. The Matter subscription reports it, the watcher translates it, the bus carries it
        // and the channel pushes it to a socket. Every piece has its own unit tests; the path
        // through all of them has none.
        const hub = await startHub(t);
        const device = await startDevice(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);
        const notification = collectNotifications(ws);
        await call(ws, SUBSCRIBE_METHOD, undefined, "sub");
        await call(ws, "node.commission", { setupCode: device.manualPairingCode }, "commission");

        await device.setOn(true);

        const changed = await notification("endpoint:changed");
        const params = changed.params as { clusterId: number; attributeId: number; value: unknown };
        assert.equal(params.clusterId, ON_OFF_CLUSTER);
        assert.equal(params.attributeId, ON_OFF_ATTRIBUTE);
        assert.equal(params.value, true);
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
        await call(ws, "node.commission", { setupCode: device.manualPairingCode }, "commission");
        const endpoints = (await call(ws, "endpoint.list", {}, "endpoints")) as EndpointState[];
        const endpointId = endpoints[0]?.id;
        assert.ok(
            endpointId !== undefined,
            `endpoint.list returned no endpoint to invoke: ${JSON.stringify(endpoints)}`,
        );

        assert.equal(device.isOn(), false);
        // Called rather than requested: a refused invoke would otherwise surface only as the light
        // still being off, with the hub's answer lost.
        await call(ws, "endpoint.invoke", { id: endpointId, clusterId: ON_OFF_CLUSTER, commandId: ON_COMMAND }, "on");

        assert.equal(device.isOn(), true);
    });
    test("keeps a commissioned device as it was across a restart", async (t) => {
        // What a service manager does on every upgrade, now with a node to keep. The boot test's
        // restart has none, and the matter package cannot start a controller to try it: this is
        // the only place the identity map is rebuilt from what the database and the SDK persisted.
        const root = freshRoot();
        const first = await startHub(t, { root });
        const device = await startDevice(t);
        const before = connect(first.url);
        t.after(() => before.close());
        await opened(before);

        const nodeId = (await call(
            before,
            "node.commission",
            { setupCode: device.manualPairingCode },
            "commission",
        )) as NodeState["id"];
        const infoBefore = (await call(before, "node.getInfo", { id: nodeId }, "info")) as NodeInfo;
        const endpointsBefore = (await call(before, "endpoint.list", {}, "endpoints")) as EndpointState[];
        await first.stop();

        const second = await startHub(t, { root });
        const after = connect(second.url);
        t.after(() => after.close());
        await opened(after);

        // The same node and the same endpoint ids a client already holds. Compared by id alone:
        // the controller reconnects its peers on its own as it comes up, so whether the node
        // reads reachable yet is a race this test does not run.
        const nodes = (await call(after, "node.list", {}, "nodes")) as NodeState[];
        assert.deepEqual(
            nodes.map(({ id }) => id),
            [nodeId],
        );
        assert.deepEqual(
            ((await call(after, "endpoint.list", {}, "endpoints")) as EndpointState[]).map(({ id }) => id),
            endpointsBefore.map(({ id }) => id),
        );
        // The commissioning time the SDK stamped when it commissioned, which only its own storage
        // can have brought back: the contract says it is not persisted, and this is where that
        // is measured.
        const infoAfter = (await call(after, "node.getInfo", { id: nodeId }, "info")) as NodeInfo;
        assert.equal(typeof infoBefore.commissionedAt, "number");
        assert.equal(infoAfter.commissionedAt, infoBefore.commissionedAt);

        // And still controllable: the command resolves through the rebuilt identity map and
        // reaches the device over a session the second controller establishes on its own.
        const endpointId = endpointsBefore[0]?.id;
        assert.ok(endpointId !== undefined, `endpoint.list returned no endpoint: ${JSON.stringify(endpointsBefore)}`);
        assert.equal(device.isOn(), false);
        await call(
            after,
            "endpoint.invoke",
            { id: endpointId, clusterId: ON_OFF_CLUSTER, commandId: ON_COMMAND },
            "on",
        );
        assert.equal(device.isOn(), true);

        // Stopped here rather than left to the teardown, which runs in registration order and
        // would close the device first: every other test stops its hub before its device, and a
        // controller closing on a peer already gone waits out retransmissions it need not.
        await second.stop();
    });
});
