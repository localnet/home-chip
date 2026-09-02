import "../../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { IntegrationError, ValidationError } from "@home-chip/contract/common/errors.ts";
import { createNodeId } from "@home-chip/contract/common/ids.ts";
import {
    CommissioningFailedError,
    DecommissioningFailedError,
    DeviceAlreadyCommissionedError,
    NodeAsleepError,
    NodeOfflineError,
    SetupCodeAmbiguousError,
} from "@home-chip/contract/node/errors.ts";
import { Millis, NoResponseTimeoutError } from "@matter/main";
import { type ClientNode, IcdPeerAsleepError, type ServerNode } from "@matter/main/node";
import { DeviceAlreadyCommissionedToThisFabricError, PeerAddress } from "@matter/main/protocol";
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
async function setup(t: { after(fn: () => Promise<void> | void): void }): Promise<{
    bus: TestEventBus;
    gateway: SdkNodeGateway;
    pairingCode: string;
}> {
    const network = new MatterTestNetwork();
    t.after(() => network.close());

    const { pairingCode } = await network.createOnOffLight();
    const bus = new TestEventBus();
    const controller = await network.createController();
    const gateway = new SdkNodeGateway(new TestLogger(), bus, new IdentityMap(), controller);
    return { bus, gateway, pairingCode };
}

describe("SdkNodeGateway", () => {
    test("commission joins a device and returns node and endpoints", async (t) => {
        const { gateway, pairingCode } = await setup(t);
        const result = await gateway.commission(pairingCode);

        assert.match(result.node.id, /^[0-9a-f-]{36}$/);
        assert.equal(typeof result.node.matterId, "bigint");

        assert.ok(result.endpoints.length >= 1);
        for (const endpoint of result.endpoints) {
            assert.equal(endpoint.nodeId, result.node.id);
            assert.equal(typeof endpoint.matterNumber, "number");
            // Endpoint 0 (root) is never registered as a domain endpoint.
            assert.notEqual(endpoint.matterNumber, 0);
            // Model X: every endpoint has a generated, non-empty default name.
            assert.equal(typeof endpoint.name, "string");
            assert.ok(endpoint.name.length > 0, "expected a non-empty default name");
            // The simulator leaves NodeLabel empty, so the default is the ProductName.
            assert.equal(endpoint.name, "Test OnOff Light");
        }
    });

    test("getInfo returns the device's basic information", async (t) => {
        const { gateway, pairingCode } = await setup(t);
        const result = await gateway.commission(pairingCode);
        const info = gateway.getInfo(result.node.id);

        assert.equal(info.id, result.node.id);
        assert.equal(info.vendorName, "HomeChip Test");
        assert.equal(info.productName, "Test OnOff Light");
        assert.equal(info.vendorId, 0xfff1);
        assert.equal(info.softwareVersionString, "1.0.0");
        // Hexadecimal with the prefix, the form a client parses back with BigInt and the one the
        // SDK's own log carries without it. Compared against the id the commissioning returned,
        // so the assertion holds whatever node id the fabric assigned.
        assert.equal(info.matterId, `0x${result.node.matterId.toString(16)}`);
        assert.match(info.matterId, /^0x[0-9a-f]+$/);
        // commissionedAt is served live from the SDK: a number when provided, else null.
        assert.ok(info.commissionedAt === null || typeof info.commissionedAt === "number");
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

            assert.deepEqual(options(), { pairingCode: "34970112332" });
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

            assert.deepEqual(options(), { passcode: 20202021, discriminator: 3840 });
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

        test("force bypasses the asleep path a normal decommission would hit", async () => {
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

        test("maps IcdPeerAsleepError to NodeAsleepError, preserving the cause", async () => {
            const sdkError = new IcdPeerAsleepError(
                PeerAddress({ fabricIndex: FabricIndex(1), nodeId: NodeId(1n) }),
                Millis(1000),
            );
            const { gateway, nodeId } = gatewayThrowing(sdkError);
            await assert.rejects(
                () => gateway.decommission(nodeId),
                (error: unknown) => {
                    assert.ok(error instanceof NodeAsleepError);
                    assert.equal(error.cause, sdkError);
                    return true;
                },
            );
        });

        test("maps a no-response timeout (device offline) to NodeOfflineError", async () => {
            const { gateway, nodeId } = gatewayThrowing(new NoResponseTimeoutError("no response"));
            await assert.rejects(() => gateway.decommission(nodeId), NodeOfflineError);
        });

        test("falls back to DecommissioningFailedError for any other SDK error", async () => {
            const { gateway, nodeId } = gatewayThrowing(new Error("fabric removal rejected"));
            await assert.rejects(() => gateway.decommission(nodeId), DecommissioningFailedError);
        });

        test("lets a domain error through unwrapped, so callers keep tolerating an absent node", async () => {
            const { gateway } = gatewayThrowing(new Error("unused"));
            // A node id the gateway does not hold: #requireNode throws NodeNotFoundError before the
            // SDK call, and the mapper must not turn it into an integration failure.
            await assert.rejects(() => gateway.decommission(createNodeId()), /not found/);
        });

        test("does not classify a generic integration failure as unreachable", async () => {
            const { gateway, nodeId } = gatewayThrowing(new Error("encoding failure"));
            await assert.rejects(
                () => gateway.decommission(nodeId),
                (error: unknown) => {
                    assert.ok(error instanceof IntegrationError);
                    assert.equal(error instanceof NodeAsleepError, false);
                    assert.equal(error instanceof NodeOfflineError, false);
                    return true;
                },
            );
        });
    });
});
