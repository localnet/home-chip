import "../../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "@home-chip/contract/common/errors.ts";
import { createNodeId } from "@home-chip/contract/common/ids.ts";
import {
    CommissioningFailedError,
    DecommissioningFailedError,
    DeviceAlreadyCommissionedError,
    NodeAsleepError,
    NodeNotFoundError,
    NodeOfflineError,
    SetupCodeAmbiguousError,
} from "@home-chip/contract/node/errors.ts";
import { Millis, NoResponseTimeoutError, Observable } from "@matter/main";
import { type ClientNode, IcdPeerAsleepError, type ServerNode } from "@matter/main/node";
import { DeviceAlreadyCommissionedToThisFabricError, PeerAddress, PeerUnreachableError } from "@matter/main/protocol";
import { CommissioningFlowType, FabricIndex, NodeId, QrPairingCodeCodec, VendorId } from "@matter/main/types";

import { SdkNodeGateway } from "../../src/gateways/node.ts";
import { IdentityMap } from "../../src/identity.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { MatterTestNetwork } from "../helpers/device.ts";
import { TestLogger } from "../helpers/logger.ts";

/**
 * Each test builds its own network, controller, and device, then tears them all down
 * via t.after(). A fresh device per test avoids commissioning the same node repeatedly
 * (which accumulates sessions and subscriptions), and closing every node releases the
 * SDK timers that would otherwise keep the runner alive.
 */
async function setup(
    t: { after(fn: () => Promise<void> | void): void },
    names?: Parameters<MatterTestNetwork["createOnOffLight"]>[0],
): Promise<{
    bus: TestEventBus;
    gateway: SdkNodeGateway;
    pairingCode: string;
    endpointNumber: number;
}> {
    const network = new MatterTestNetwork();
    t.after(() => network.close());

    const { pairingCode, endpointNumber } = await network.createOnOffLight(names);
    const bus = new TestEventBus();
    const controller = await network.createController();
    const gateway = new SdkNodeGateway(new TestLogger(), bus, new IdentityMap(), controller);
    return { bus, gateway, pairingCode, endpointNumber };
}

describe("SdkNodeGateway", () => {
    test("commission joins a device and returns node and endpoints", async (t) => {
        const { gateway, pairingCode, endpointNumber } = await setup(t);
        const result = await gateway.commission(pairingCode);

        assert.match(result.node.id, /^[0-9a-f-]{36}$/);
        assert.equal(typeof result.node.matterId, "bigint");
        // The light's endpoint alone: the root is the node itself, never a domain endpoint.
        assert.deepEqual(
            result.endpoints.map(({ id: _id, ...endpoint }) => endpoint),
            [{ nodeId: result.node.id, matterNumber: endpointNumber, name: "Test OnOff Light", roomId: null }],
        );
    });

    test("names a node's endpoints after its NodeLabel, else its ProductName, else a constant", async (t) => {
        // A blank name counts as none, since it would give the endpoint nothing a user can see.
        const cases = [
            { names: { nodeLabel: "Kitchen light" }, expected: "Kitchen light" },
            { names: { nodeLabel: "   " }, expected: "Test OnOff Light" },
            { names: { nodeLabel: "", productName: "   " }, expected: "Matter Device" },
        ];
        const network = new MatterTestNetwork();
        t.after(() => network.close());
        const devices = [];
        for (const { names, expected } of cases) {
            const { pairingCode } = await network.createOnOffLight(names);
            devices.push({ names, expected, pairingCode });
        }
        const controller = await network.createController();
        const gateway = new SdkNodeGateway(new TestLogger(), new TestEventBus(), new IdentityMap(), controller);

        for (const { names, expected, pairingCode } of devices) {
            const result = await gateway.commission(pairingCode);
            assert.deepEqual(
                result.endpoints.map((endpoint) => endpoint.name),
                [expected],
                JSON.stringify(names),
            );
        }
    });

    test("getInfo returns the device's basic information", async (t) => {
        const { gateway, pairingCode } = await setup(t, { nodeLabel: "Kitchen light" });
        const before = Date.now();
        const result = await gateway.commission(pairingCode);
        const after = Date.now();

        const { commissionedAt, ...info } = gateway.getInfo(result.node.id);

        assert.deepEqual(info, {
            id: result.node.id,
            // Hexadecimal with the prefix, the form a client parses back with BigInt and the one
            // the SDK's own log carries without it.
            matterId: `0x${result.node.matterId.toString(16)}`,
            label: "Kitchen light",
            vendorName: "HomeChip Test",
            productName: "Test OnOff Light",
            vendorId: 0xfff1,
            productId: 0x8000,
            hardwareVersion: 2,
            softwareVersion: 3,
            softwareVersionString: "3.0.0",
        });
        // The SDK stamps it as the commissioning completes, so it can only fall inside the call.
        assert.ok(commissionedAt !== null && commissionedAt >= before && commissionedAt <= after);
    });

    test("getInfo throws NodeNotFoundError for an unknown node", async (t) => {
        const { gateway } = await setup(t);
        assert.throws(() => gateway.getInfo("00000000-0000-7000-8000-000000000000" as never), /not found/);
    });

    test("isReachable is true for a commissioned, online node", async (t) => {
        const { gateway, pairingCode } = await setup(t);
        const result = await gateway.commission(pairingCode);
        assert.equal(gateway.isReachable(result.node.id), true);
    });

    test("isReachable is false for an unknown node (no throw)", async (t) => {
        const { gateway } = await setup(t);
        assert.equal(gateway.isReachable("00000000-0000-7000-8000-000000000000" as never), false);
    });

    test("decommission removes a node from the fabric and forgets it", async (t) => {
        const { gateway, pairingCode } = await setup(t);
        const result = await gateway.commission(pairingCode);
        await gateway.decommission(result.node.id);
        // After removal the node is unknown to the gateway.
        assert.throws(() => gateway.getInfo(result.node.id), /not found/);
    });

    describe("lifecycle observer lifetime", () => {
        // The SDK keeps a decommissioned node's ClientNode alive and Observable.on() returns no
        // unsubscribe handle, so lifecycle observers would outlive the node unless the gateway
        // detaches them. Counting on/off calls is the direct evidence: isObserved cannot serve
        // here because the SDK observes these lifecycle observables itself.
        function subscribed() {
            let attached = 0;
            const observable = () => ({
                on: () => {
                    attached += 1;
                },
                off: () => {
                    attached -= 1;
                },
            });
            const nodeId = createNodeId();
            const node = {
                lifecycle: { online: observable(), offline: observable() },
                async decommission() {},
            } as unknown as ClientNode;
            const identity = new IdentityMap();
            identity.addNode({ nodeId, node, endpoints: [] });
            const gateway = new SdkNodeGateway(new TestLogger(), new TestEventBus(), identity, undefined as never);
            return { gateway, nodeId, attachedCount: () => attached };
        }

        test("start() attaches the online and offline observers", () => {
            const { gateway, attachedCount } = subscribed();
            assert.equal(attachedCount(), 0);
            gateway.start();
            assert.equal(attachedCount(), 2);
        });

        test("decommissioning a node detaches its lifecycle observers", async () => {
            const { gateway, nodeId, attachedCount } = subscribed();
            gateway.start();
            await gateway.decommission(nodeId);
            assert.equal(attachedCount(), 0);
        });

        test("stop() detaches the lifecycle observers of every subscribed node", () => {
            const { gateway, attachedCount } = subscribed();
            gateway.start();
            gateway.stop();
            assert.equal(attachedCount(), 0);
        });
    });

    describe("lifecycle events", () => {
        /**
         * A gateway watching one node whose online and offline are real SDK observables, fired by
         * the test. `decommission` is what the node's own decommission() does when called.
         */
        function watching(decommission: () => Promise<void> = async () => {}) {
            const nodeId = createNodeId();
            const online = Observable();
            const offline = Observable();
            const node = { lifecycle: { online, offline }, decommission } as unknown as ClientNode;
            const identity = new IdentityMap();
            identity.addNode({ nodeId, node, endpoints: [] });
            const bus = new TestEventBus();
            const gateway = new SdkNodeGateway(new TestLogger(), bus, identity, undefined as never);
            gateway.start();
            return { bus, gateway, nodeId, online, offline };
        }

        test("announces each transition of a watched node", (t) => {
            t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
            const { bus, nodeId, online, offline } = watching();

            online.emit();
            offline.emit();

            assert.deepEqual(bus.emitted, [
                { name: "node:connected", payload: { nodeId, timestamp: 1_000 } },
                { name: "node:disconnected", payload: { nodeId, timestamp: 1_000 } },
            ]);
        });

        test("does not report a node leaving the fabric as a disconnection", async (t) => {
            // A real device rather than a fake, because the question is the SDK's: whether it takes
            // the node offline while decommission() is still pending, which is the only window the
            // gateway filters. A fake would answer it by construction.
            const { bus, gateway, pairingCode } = await setup(t);
            const result = await gateway.commission(pairingCode);
            gateway.start();

            await gateway.decommission(result.node.id);

            assert.deepEqual(bus.emitted, []);
        });

        test("reports disconnections again once a decommissioning has failed", async () => {
            // The node is still ours after the failure, so a later drop is news; a filter left
            // armed would hide it for the rest of the run.
            const { bus, gateway, nodeId, offline } = watching(async () => {
                throw new NoResponseTimeoutError("no response");
            });
            await assert.rejects(() => gateway.decommission(nodeId));

            offline.emit();

            assert.deepEqual(
                bus.emitted.map((event) => event.name),
                ["node:disconnected"],
            );
        });
    });

    describe("start idempotency", () => {
        test("a second start() does not subscribe a node's lifecycle twice", () => {
            let subscriptions = 0;
            const node = {
                lifecycle: {
                    online: {
                        on: () => {
                            subscriptions += 1;
                        },
                    },
                    offline: {
                        on: () => {
                            subscriptions += 1;
                        },
                    },
                },
            } as unknown as ClientNode;
            const identity = new IdentityMap();
            identity.addNode({ nodeId: createNodeId(), node, endpoints: [] });
            const gateway = new SdkNodeGateway(new TestLogger(), new TestEventBus(), identity, undefined as never);

            gateway.start();
            gateway.start();

            // online and offline, once each. Subscribing twice would emit every node:connected
            // and node:disconnected in duplicate for the rest of the process.
            assert.equal(subscriptions, 2);
        });
    });

    describe("commission failure mapping", () => {
        /** A gateway whose controller rejects commissioning with the given SDK error. */
        function gatewayThrowing(sdkError: unknown): SdkNodeGateway {
            const controller = {
                peers: {
                    commission() {
                        throw sdkError;
                    },
                },
            } as unknown as ServerNode;
            return new SdkNodeGateway(new TestLogger(), new TestEventBus(), new IdentityMap(), controller);
        }

        test("maps a device that already holds our fabric to DeviceAlreadyCommissionedError", async () => {
            const gateway = gatewayThrowing(
                new DeviceAlreadyCommissionedToThisFabricError("already commissioned into this fabric"),
            );
            await assert.rejects(() => gateway.commission("12345678901"), DeviceAlreadyCommissionedError);
        });

        test("falls back to CommissioningFailedError for any other SDK error", async () => {
            const gateway = gatewayThrowing(new Error("pairing code expired"));
            await assert.rejects(() => gateway.commission("12345678901"), CommissioningFailedError);
        });
    });

    describe("setup code forms", () => {
        /** The fields these tests read back off the options the gateway handed the SDK. */
        type SeenOptions = {
            pairingCode?: string;
            passcode?: number;
            discriminator?: number;
            autoStateInitialize?: boolean;
        };

        /** A gateway whose commissioning records the options it was handed. */
        function gatewayRecording(): { gateway: SdkNodeGateway; options: () => unknown } {
            let seen: unknown;
            const controller = {
                peers: {
                    commission(options: unknown) {
                        seen = options;
                        // Enough of a ClientNode for commission() to give up before composing.
                        return Promise.reject(new Error("stop here"));
                    },
                },
            } as unknown as ServerNode;
            const gateway = new SdkNodeGateway(new TestLogger(), new TestEventBus(), new IdentityMap(), controller);
            return { gateway, options: () => seen };
        }

        test("hands a manual pairing code to the SDK as it came", async () => {
            // The SDK decodes this form itself, so passing it through keeps one decoder.
            const { gateway, options } = gatewayRecording();

            await assert.rejects(() => gateway.commission("34970112332"));

            const seen = options() as SeenOptions;
            assert.equal(seen.pairingCode, "34970112332");
            // Not decoded here: had it been, the SDK would receive the parts instead.
            assert.equal(seen.passcode, undefined);
        });

        test("asks for the initial state read on every commission", async () => {
            // The endpoints commission() composes come from that read, and the option is the only
            // place the SDK takes the answer from. Asserted apart from the setup-code tests around
            // it, which are about the code's form and not about what else the options carry.
            const { gateway, options } = gatewayRecording();

            await assert.rejects(() => gateway.commission("34970112332"));

            assert.equal((options() as SeenOptions).autoStateInitialize, true);
        });

        test("decodes a QR payload here, the SDK's pairingCode reading only manual codes", async () => {
            const { gateway, options } = gatewayRecording();
            const qr = QrPairingCodeCodec.encode([
                {
                    version: 0,
                    vendorId: VendorId(0xfff1),
                    productId: 0x8000,
                    flowType: CommissioningFlowType.Standard,
                    discoveryCapabilities: 4,
                    discriminator: 3840,
                    passcode: 20202021,
                },
            ]);

            await assert.rejects(() => gateway.commission(qr));

            const seen = options() as SeenOptions;
            assert.equal(seen.passcode, 20202021);
            assert.equal(seen.discriminator, 3840);
            // Not handed over as a pairing code: the SDK's own reading of that field takes manual
            // codes only, so a QR passed through would never be decoded at all.
            assert.equal(seen.pairingCode, undefined);
        });

        test("refuses a QR payload carrying more than one device", async () => {
            // Nothing in a concatenated payload says which device to pair, so pairing with
            // whichever answers first would be a coin toss.
            const { gateway } = gatewayRecording();
            const device = {
                version: 0,
                vendorId: VendorId(0xfff1),
                flowType: CommissioningFlowType.Standard,
                discoveryCapabilities: 4,
            };
            const qr = QrPairingCodeCodec.encode([
                { ...device, productId: 0x8000, discriminator: 3840, passcode: 20202021 },
                { ...device, productId: 0x8001, discriminator: 3841, passcode: 20202022 },
            ]);

            await assert.rejects(() => gateway.commission(qr), SetupCodeAmbiguousError);
        });

        test("reports an unreadable QR payload as a validation failure, nothing having been contacted", async () => {
            const { gateway } = gatewayRecording();

            await assert.rejects(() => gateway.commission("MT:NOTAVALIDPAYLOAD"), ValidationError);
        });
    });

    describe("decommission failure mapping", () => {
        /** A gateway holding one node that records which SDK removal path was taken. */
        function gatewayRecording(): {
            gateway: SdkNodeGateway;
            nodeId: ReturnType<typeof createNodeId>;
            calls: string[];
            identity: IdentityMap;
        } {
            const nodeId = createNodeId();
            const calls: string[] = [];
            const node = {
                async decommission() {
                    calls.push("decommission");
                },
                async delete() {
                    calls.push("delete");
                },
            } as unknown as ClientNode;
            const identity = new IdentityMap();
            identity.addNode({ nodeId: nodeId, node, endpoints: [] });
            const gateway = new SdkNodeGateway(new TestLogger(), new TestEventBus(), identity, undefined as never);
            return { gateway, nodeId, calls, identity };
        }

        test("without force, removes our fabric from the device", async () => {
            const { gateway, nodeId, calls, identity } = gatewayRecording();
            await gateway.decommission(nodeId);
            assert.deepEqual(calls, ["decommission"]);
            assert.equal([...identity.nodeIdentities()].length, 0);
        });

        test("with force, drops the node locally without contacting the device", async () => {
            const { gateway, nodeId, calls, identity } = gatewayRecording();
            await gateway.decommission(nodeId, true);
            assert.deepEqual(calls, ["delete"]);
            assert.equal([...identity.nodeIdentities()].length, 0);
        });

        test("keeps a node whose decommissioning failed, so a forced retry can still find it", async () => {
            // The retry an asleep ICD leaves the operator with. Had the failure dropped the node,
            // the forced call would meet NodeNotFoundError instead.
            const nodeId = createNodeId();
            const node = {
                decommission() {
                    throw new IcdPeerAsleepError(
                        PeerAddress({ fabricIndex: FabricIndex(1), nodeId: NodeId(1n) }),
                        Millis(1000),
                    );
                },
                async delete() {},
            } as unknown as ClientNode;
            const identity = new IdentityMap();
            identity.addNode({ nodeId: nodeId, node, endpoints: [] });
            const gateway = new SdkNodeGateway(new TestLogger(), new TestEventBus(), identity, undefined as never);

            await assert.rejects(() => gateway.decommission(nodeId), NodeAsleepError);
            await assert.doesNotReject(() => gateway.decommission(nodeId, true));
        });

        /** A gateway holding one node whose decommission() throws the given SDK error. */
        function gatewayThrowing(sdkError: unknown): {
            gateway: SdkNodeGateway;
            nodeId: ReturnType<typeof createNodeId>;
        } {
            const nodeId = createNodeId();
            const node = {
                decommission() {
                    throw sdkError;
                },
            } as unknown as ClientNode;
            const identity = new IdentityMap();
            identity.addNode({ nodeId: nodeId, node, endpoints: [] });
            const gateway = new SdkNodeGateway(new TestLogger(), new TestEventBus(), identity, undefined as never);
            return { gateway, nodeId };
        }

        test("maps each SDK failure to its domain error, keeping it as the cause", async () => {
            const failures = [
                {
                    sdkError: new IcdPeerAsleepError(
                        PeerAddress({ fabricIndex: FabricIndex(1), nodeId: NodeId(1n) }),
                        Millis(1000),
                    ),
                    expected: NodeAsleepError,
                },
                { sdkError: new NoResponseTimeoutError("no response"), expected: NodeOfflineError },
                { sdkError: new PeerUnreachableError(Millis(5000)), expected: NodeOfflineError },
                { sdkError: new Error("fabric removal rejected"), expected: DecommissioningFailedError },
            ];

            for (const { sdkError, expected } of failures) {
                const { gateway, nodeId } = gatewayThrowing(sdkError);
                await assert.rejects(
                    () => gateway.decommission(nodeId),
                    (error: unknown) => {
                        const row = sdkError.constructor.name;
                        assert.ok(error instanceof expected, row);
                        assert.equal(error.cause, sdkError, row);
                        assert.deepEqual(error.data, { id: nodeId }, row);
                        return true;
                    },
                );
            }
        });

        test("lets a domain error through unwrapped, so callers keep tolerating an absent node", async () => {
            const { gateway } = gatewayThrowing(new Error("unused"));
            // A node id the gateway does not hold: #requireNode throws NodeNotFoundError before the
            // SDK call, and the mapper must not turn it into an integration failure.
            await assert.rejects(() => gateway.decommission(createNodeId()), NodeNotFoundError);
        });
    });
});
