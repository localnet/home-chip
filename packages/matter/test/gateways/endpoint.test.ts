import "../../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { ValidationError } from "@home-chip/contract/common/errors.ts";
import { createEndpointId, createNodeId, type EndpointId } from "@home-chip/contract/common/ids.ts";
import {
    AttributeNotFoundError,
    CommandNotFoundError,
    CommandRejectedError,
    EndpointAsleepError,
    EndpointNotFoundError,
    EndpointOfflineError,
    InteractionFailedError,
    WriteRejectedError,
} from "@home-chip/contract/endpoint/errors.ts";
import { Millis, NoResponseTimeoutError } from "@matter/main";
import { type ClientNode, IcdPeerAsleepError } from "@matter/main/node";
import { PeerAddress, PeerUnreachableError } from "@matter/main/protocol";
import { FabricIndex, NodeId, Status } from "@matter/main/types";
import { SdkEndpointGateway } from "../../src/gateways/endpoint.ts";
import { SdkNodeGateway } from "../../src/gateways/node.ts";
import { IdentityMap, type NodeIdentity } from "../../src/identity.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { MatterTestNetwork } from "../helpers/device.ts";
import { TestLogger } from "../helpers/logger.ts";

// OnOff cluster (0x0006): the On/Off light exposes it on its functional endpoint.
const ON_OFF_CLUSTER = 6;
const ON_OFF_ATTRIBUTE = 0;
const ON_COMMAND = 1;
const ON_TIME_ATTRIBUTE = 0x4001;
const THERMOSTAT_CLUSTER = 0x0201;
const SETPOINT_RAISE_LOWER_COMMAND = 0;
const OFF_COMMAND = 0;
const OCCUPIED_HEATING_SETPOINT = 0x12;
// Descriptor (0x001d) is served by every endpoint, and its PartsList is a list, which is what
// makes it a value the SDK has to encode rather than pass through.
const DESCRIPTOR_CLUSTER = 0x001d;
const PARTS_LIST_ATTRIBUTE = 3;
// MEI type suffix past 0x4fff, which is what makes them unaddressable rather than merely absent.
const UNADDRESSABLE_CLUSTER = 0x99999999;
const UNADDRESSABLE_ATTRIBUTE = 0x9999;

/**
 * Commissions a real simulated On/Off light through the node gateway (which populates the
 * shared IdentityMap), then builds the endpoint gateway over that same map and starts it.
 * The endpoint gateway resolves and watches endpoints entirely from the IdentityMap, so no
 * repository or database is involved. A fresh device per test avoids accumulating SDK
 * sessions; closing the network releases the timers that would keep the runner alive.
 */
async function setup(t: { after(fn: () => Promise<void> | void): void }): Promise<{
    bus: TestEventBus;
    gateway: SdkEndpointGateway;
    endpointId: EndpointId;
}> {
    const network = new MatterTestNetwork();
    t.after(() => network.close());

    const { pairingCode } = await network.createOnOffLight();
    const bus = new TestEventBus();
    const logger = new TestLogger();
    const identity = new IdentityMap();
    const controller = await network.createController();

    const nodeGateway = new SdkNodeGateway(logger, bus, identity, controller);
    const result = await nodeGateway.commission(pairingCode);

    // The functional endpoint is the one carrying the OnOff cluster (endpoint number >= 1);
    // endpoint 0 is the root. Pick the first non-root endpoint.
    const functional = result.endpoints.find((endpoint) => endpoint.matterNumber >= 1);
    assert.ok(functional, "expected a functional endpoint");

    const gateway = new SdkEndpointGateway(logger, bus, identity);
    gateway.start();

    return { bus, gateway, endpointId: functional.id };
}

describe("SdkEndpointGateway", () => {
    describe("read", () => {
        test("reads an attribute value by numeric ids", async (t) => {
            const { gateway, endpointId } = await setup(t);

            const value = await gateway.read(endpointId, ON_OFF_CLUSTER, ON_OFF_ATTRIBUTE);

            // A fresh On/Off light starts off.
            assert.equal(value, false);
        });

        test("throws ValidationError for ids Matter cannot address", async (t) => {
            // An id is addressable only as a global attribute or with an MEI type suffix up to
            // 0x4fff, which is narrower than the range the params schema accepts. Read is the one
            // method that can meet one: write and invoke resolve through the cluster model first,
            // and nothing unaddressable is in it.
            const { gateway, endpointId } = await setup(t);

            await assert.rejects(
                () => gateway.read(endpointId, UNADDRESSABLE_CLUSTER, ON_OFF_ATTRIBUTE),
                ValidationError,
            );
            await assert.rejects(
                () => gateway.read(endpointId, ON_OFF_CLUSTER, UNADDRESSABLE_ATTRIBUTE),
                ValidationError,
            );
        });

        test("throws AttributeNotFoundError when the device does not serve the path", async (t) => {
            // Thermostat on an On/Off light: the ids are addressable, so the path leaves the hub
            // and the refusal comes back as a status. Where write learns the same thing locally
            // from the cluster model, read learns it only from the device's answer.
            const { gateway, endpointId } = await setup(t);

            await assert.rejects(
                () => gateway.read(endpointId, THERMOSTAT_CLUSTER, OCCUPIED_HEATING_SETPOINT),
                AttributeNotFoundError,
            );
        });
    });

    describe("write", () => {
        test("writes an attribute and the device holds the new value", async (t) => {
            // OnOff.OnTime is writable where OnOff itself is not, which is the point of having a
            // write at all: some device state is only reachable this way, never by a command.
            const { gateway, endpointId } = await setup(t);

            await gateway.write(endpointId, ON_OFF_CLUSTER, ON_TIME_ATTRIBUTE, 30);

            assert.equal(await gateway.read(endpointId, ON_OFF_CLUSTER, ON_TIME_ATTRIBUTE), 30);
        });

        test("throws AttributeNotFoundError for an attribute unknown to the model", async (t) => {
            // Refused before the device is contacted: the write addresses the attribute by name
            // against the cluster descriptor, and an id the model does not know has no name.
            const { gateway, endpointId } = await setup(t);

            await assert.rejects(() => gateway.write(endpointId, ON_OFF_CLUSTER, 0x9999, 1), AttributeNotFoundError);
        });

        test("throws ValidationError for a value the attribute's type does not accept", async (t) => {
            // The SDK encodes the value against the attribute's schema while the request is
            // built, so a list attribute handed a scalar fails with nothing contacted. That is
            // what separates it from the rejected write below, which needs a device to refuse.
            const { gateway, endpointId } = await setup(t);

            await assert.rejects(
                () => gateway.write(endpointId, DESCRIPTOR_CLUSTER, PARTS_LIST_ATTRIBUTE, 5),
                ValidationError,
            );
        });

        test("throws WriteRejectedError, carrying the device's status, when it refuses the write", async (t) => {
            // OnOff itself is read-only, so the device answers UnsupportedWrite. The status is what
            // tells a client which refusal it met, and the gateway alone can carry it across.
            const { gateway, endpointId } = await setup(t);

            await assert.rejects(
                () => gateway.write(endpointId, ON_OFF_CLUSTER, ON_OFF_ATTRIBUTE, true),
                (error: unknown) => {
                    assert.ok(error instanceof WriteRejectedError);
                    assert.deepEqual(error.data, {
                        endpointId,
                        clusterId: ON_OFF_CLUSTER,
                        attributeId: ON_OFF_ATTRIBUTE,
                        statusCode: Status.UnsupportedWrite,
                    });
                    return true;
                },
            );
        });
    });

    describe("invoke", () => {
        test("invokes a command and the device state changes", async (t) => {
            const { gateway, endpointId } = await setup(t);
            assert.equal(await gateway.read(endpointId, ON_OFF_CLUSTER, ON_OFF_ATTRIBUTE), false);

            await gateway.invoke(endpointId, ON_OFF_CLUSTER, ON_COMMAND);
            assert.equal(await gateway.read(endpointId, ON_OFF_CLUSTER, ON_OFF_ATTRIBUTE), true);

            await gateway.invoke(endpointId, ON_OFF_CLUSTER, OFF_COMMAND);
            assert.equal(await gateway.read(endpointId, ON_OFF_CLUSTER, ON_OFF_ATTRIBUTE), false);
        });

        test("throws CommandNotFoundError for a command unknown to the model", async (t) => {
            const { gateway, endpointId } = await setup(t);
            // Command id 9999 does not exist on the OnOff cluster.
            await assert.rejects(() => gateway.invoke(endpointId, ON_OFF_CLUSTER, 9999), CommandNotFoundError);
        });

        test("throws ValidationError for arguments the command's fields do not accept", async (t) => {
            // The same command the device refuses below, with a mandatory field left out. The SDK
            // encodes the fields while the request is built, so this one never reaches a device
            // and cannot carry a status.
            const { gateway, endpointId } = await setup(t);

            await assert.rejects(
                () => gateway.invoke(endpointId, THERMOSTAT_CLUSTER, SETPOINT_RAISE_LOWER_COMMAND, { mode: 0 }),
                ValidationError,
            );
        });

        test("throws CommandRejectedError, carrying the device's status, when it refuses the command", async (t) => {
            // A cluster the Matter model knows but this device does not carry, so resolution
            // succeeds and the refusal comes back from the device as UnsupportedCluster: the
            // counterpart of a rejected write.
            const { gateway, endpointId } = await setup(t);

            await assert.rejects(
                () =>
                    gateway.invoke(endpointId, THERMOSTAT_CLUSTER, SETPOINT_RAISE_LOWER_COMMAND, {
                        mode: 0,
                        amount: 1,
                    }),
                (error: unknown) => {
                    assert.ok(error instanceof CommandRejectedError);
                    assert.deepEqual(error.data, {
                        endpointId,
                        clusterId: THERMOSTAT_CLUSTER,
                        commandId: SETPOINT_RAISE_LOWER_COMMAND,
                        statusCode: Status.UnsupportedCluster,
                    });
                    return true;
                },
            );
        });
    });

    describe("describe", () => {
        test("assembles the endpoint's device type and cluster state", async (t) => {
            const { gateway, endpointId } = await setup(t);
            const shape = gateway.describe(endpointId);

            // OnOff Light application device type (0x0100 = 256).
            assert.equal(shape.deviceType, 256);

            const onOff = shape.clusters.find((cluster) => cluster.id === ON_OFF_CLUSTER);
            assert.ok(onOff, "expected the OnOff cluster in the shape");
            // Accepted commands include Off(0), On(1), Toggle(2).
            for (const command of [OFF_COMMAND, ON_COMMAND, 2]) {
                assert.ok(onOff.acceptedCommands.includes(command), `expected accepted command ${command}`);
            }
            // The onOff attribute (id 0) is present and a fresh light is off.
            const onOffAttribute = onOff.attributes.find((attribute) => attribute.id === ON_OFF_ATTRIBUTE);
            assert.ok(onOffAttribute, "expected the onOff attribute in the cluster state");
            assert.equal(onOffAttribute.value, false);
        });
    });

    describe("endpoint resolution", () => {
        test("every method refuses an endpoint that is not mapped", async (t) => {
            // One property of #resolve, which all four share, rather than four copies of it.
            const { gateway } = await setup(t);
            const unmapped = "unknown-endpoint" as EndpointId;

            await assert.rejects(() => gateway.read(unmapped, ON_OFF_CLUSTER, ON_OFF_ATTRIBUTE), EndpointNotFoundError);
            await assert.rejects(
                () => gateway.write(unmapped, ON_OFF_CLUSTER, ON_TIME_ATTRIBUTE, 30),
                EndpointNotFoundError,
            );
            await assert.rejects(() => gateway.invoke(unmapped, ON_OFF_CLUSTER, ON_COMMAND), EndpointNotFoundError);
            assert.throws(() => gateway.describe(unmapped), EndpointNotFoundError);
        });
    });

    describe("read, write and invoke error mapping", () => {
        // The NetworkSimulator cannot reproduce a sleeping ICD (matter.js nodes never sleep) nor a
        // dropped peer session on demand, so these drive the shared mapper directly: a fake node
        // whose interaction.read/invoke throws the SDK error, resolved through the gateway. read and
        // invoke read only from the IdentityMap here, so no start()/watch (which would need real
        // endpoint structure) is required.
        function gatewayThrowing(sdkError: unknown): { gateway: SdkEndpointGateway; endpointId: EndpointId } {
            const endpointId = createEndpointId();
            const node = {
                // All three operations fail the same way, which is what the shared mapper is
                // being tested for.
                interaction: {
                    invoke() {
                        throw sdkError;
                    },
                    read() {
                        throw sdkError;
                    },
                    write() {
                        throw sdkError;
                    },
                },
            } as unknown as ClientNode;
            const identity = new IdentityMap();
            const nodeIdentity: NodeIdentity = {
                nodeId: createNodeId(),
                node,
                endpoints: [{ endpointId: endpointId, endpointNumber: 1 }],
            };
            identity.addNode(nodeIdentity);
            const gateway = new SdkEndpointGateway(new TestLogger(), new TestEventBus(), identity);
            return { gateway, endpointId };
        }

        // Each operation catches on its own, and read's catch differs from the others' in letting
        // its own not-found through, so every failure is driven through all three.
        test("maps each SDK failure to its domain error, alike in read, write and invoke", async () => {
            const failures = [
                {
                    sdkError: new IcdPeerAsleepError(
                        PeerAddress({ fabricIndex: FabricIndex(1), nodeId: NodeId(1n) }),
                        Millis(1000),
                    ),
                    expected: EndpointAsleepError,
                },
                { sdkError: new NoResponseTimeoutError("no response"), expected: EndpointOfflineError },
                { sdkError: new PeerUnreachableError(Millis(5000)), expected: EndpointOfflineError },
                { sdkError: new Error("encoding failure"), expected: InteractionFailedError },
            ];
            const operations = [
                {
                    name: "read",
                    call: (gateway: SdkEndpointGateway, id: EndpointId) =>
                        gateway.read(id, ON_OFF_CLUSTER, ON_OFF_ATTRIBUTE),
                },
                {
                    name: "write",
                    call: (gateway: SdkEndpointGateway, id: EndpointId) =>
                        gateway.write(id, ON_OFF_CLUSTER, ON_TIME_ATTRIBUTE, 30),
                },
                {
                    name: "invoke",
                    call: (gateway: SdkEndpointGateway, id: EndpointId) =>
                        gateway.invoke(id, ON_OFF_CLUSTER, ON_COMMAND),
                },
            ];

            for (const { sdkError, expected } of failures) {
                for (const { name, call } of operations) {
                    const { gateway, endpointId } = gatewayThrowing(sdkError);
                    await assert.rejects(
                        () => call(gateway, endpointId),
                        (error: unknown) => {
                            const row = `${name} of ${sdkError.constructor.name}`;
                            assert.ok(error instanceof expected, row);
                            assert.equal(error.cause, sdkError, row);
                            assert.deepEqual(error.data, { endpointId, clusterId: ON_OFF_CLUSTER }, row);
                            return true;
                        },
                    );
                }
            }
        });
    });

    describe("change events", () => {
        test("reports a change on the device as endpoint:changed, in numeric ids", async (t) => {
            // OnTime rather than OnOff: writing it changes that one attribute, where turning the
            // light on also moves GlobalSceneControl, so the first event to arrive is known.
            const { bus, gateway, endpointId } = await setup(t);
            const before = Date.now();
            const changed = new Promise<{ timestamp: number }>((resolve) => {
                bus.on("endpoint:changed", resolve);
            });

            await gateway.write(endpointId, ON_OFF_CLUSTER, ON_TIME_ATTRIBUTE, 30);
            const deadline = new AbortController();
            const { timestamp, ...change } = await Promise.race([
                changed,
                sleep(10_000, undefined, { signal: deadline.signal }).then(() =>
                    assert.fail("no endpoint:changed within 10 s"),
                ),
            ]).finally(() => deadline.abort());

            assert.deepEqual(change, {
                endpointId,
                clusterId: ON_OFF_CLUSTER,
                attributeId: ON_TIME_ATTRIBUTE,
                value: 30,
            });
            // Not pinned with mocked timers: the SDK runs on the same clock, and freezing it
            // would stall the simulated network the change travels over.
            assert.ok(timestamp >= before && timestamp <= Date.now());
        });
    });

    describe("watch lifecycle", () => {
        // The SDK keeps a decommissioned node's ClientNode and endpoints alive, and
        // Observable.on() returns no unsubscribe handle, so attribute observers we attach would
        // outlive the node unless the gateway detaches them explicitly. isObserved on the live
        // SDK observable is the direct evidence that it did.
        async function watched(t: { after(fn: () => Promise<void> | void): void }) {
            const network = new MatterTestNetwork();
            t.after(() => network.close());

            const { pairingCode } = await network.createOnOffLight();
            const logger = new TestLogger();
            const identity = new IdentityMap();
            const controller = await network.createController();
            const nodeGateway = new SdkNodeGateway(logger, new TestEventBus(), identity, controller);
            const result = await nodeGateway.commission(pairingCode);
            const functional = result.endpoints.find((endpoint) => endpoint.matterNumber >= 1);
            assert.ok(functional, "expected a functional endpoint");

            const [identityEntry] = [...identity.nodeIdentities()];
            assert.ok(identityEntry, "expected the commissioned node in the identity map");
            const endpoint = identityEntry.node.parts.get(functional.matterNumber);
            assert.ok(endpoint, "expected the SDK endpoint");
            const events = endpoint.events as Record<string, Record<string, { isObserved: boolean } | undefined>>;
            const onOffChanged = events.onOff?.onOff$Changed;
            assert.ok(onOffChanged, "expected an onOff$Changed observable");

            const gateway = new SdkEndpointGateway(logger, new TestEventBus(), identity);
            return { gateway, nodeGateway, nodeId: result.node.id, onOffChanged };
        }

        test("start() attaches an attribute observer", async (t) => {
            const { gateway, onOffChanged } = await watched(t);
            assert.equal(onOffChanged.isObserved, false);
            gateway.start();
            assert.equal(onOffChanged.isObserved, true);
        });

        test("decommissioning a node detaches its attribute observers", async (t) => {
            const { gateway, nodeGateway, nodeId, onOffChanged } = await watched(t);
            gateway.start();
            await nodeGateway.decommission(nodeId);
            assert.equal(onOffChanged.isObserved, false);
        });

        test("stop() detaches the attribute observers of every watched node", async (t) => {
            const { gateway, onOffChanged } = await watched(t);
            gateway.start();
            gateway.stop();
            assert.equal(onOffChanged.isObserved, false);
        });

        test("watches again when started after a stop", async (t) => {
            const { gateway, onOffChanged } = await watched(t);
            gateway.start();
            gateway.stop();

            gateway.start();

            assert.equal(onOffChanged.isObserved, true);
        });
    });
});
