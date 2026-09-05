import { createWriteStream, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { Endpoint, Environment, LogFormat, Logger, ServerNode, VendorId } from "@matter/main";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffLightDevice } from "@matter/main/devices";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";

// @matter/main is deliberately undeclared here, as it is in the matter package for @matter/nodejs.
// The one copy in the tree is the one @home-chip/matter pins, and that is the point: a device
// speaking a different build of the SDK than the controller it pairs with would be testing an
// interop nobody ships. Declaring a version here allows a skew, and npm resolves a skew with a
// second nested copy — two SDKs in one process, each with its own singletons. An import that
// stops resolving fails loudly at the first run; a duplicated SDK would not fail at all.

/**
 * The operational port the device listens on. The hub's controller takes the standard 5540 even
 * with commissioning disabled, so a device sharing the host needs one of its own.
 */
const DEVICE_PORT = 5541;

/** A second port, so a bridge and a light can run side by side when a test wants both. */
const BRIDGE_PORT = 5542;

/** Passcode and discriminator the SDK itself uses for development, and the pairing codes derive. */
const PASSCODE = 20202021;
const DISCRIMINATOR = 3840;

let configured = false;
let minted = 0;

/**
 * A node id no other device in this run has used.
 *
 * The SDK partitions storage by node id, so two devices sharing one would share a directory, and
 * the second would open what the first left: already commissioned into a fabric that no longer
 * exists, never advertising itself, leaving the hub waiting for a device that will not appear.
 */
const uniqueId = (name: string): string => `${name}-${++minted}`;

/**
 * Points the SDK in this process at a directory of its own and a log file of its own, once.
 *
 * The hub used to do both for us: it ran in the same process and configured the shared
 * `Environment.default` on its way up. It runs as its own process now, so nothing here is
 * configured — the SDK would fall back to `~/.matter`, where a device outlives the test that made
 * it, and would write its log to the console, where a passing run buries the results under it.
 */
function configureSdk(): void {
    if (configured) {
        return;
    }
    configured = true;

    const root = mkdtempSync(join(tmpdir(), "home-chip-e2e-devices-"));
    Environment.default.vars.set("storage.path", root);

    // Kept rather than silenced: it is what diagnosed a device inheriting a previous fabric, and
    // it costs nothing to write. The path is printed when a device fails to come up.
    const destination = Logger.destinations.default;
    if (destination !== undefined) {
        const stream = createWriteStream(join(root, "matter.log"), { flags: "a" });
        destination.write = (text: string) => {
            stream.write(`${text}\n`);
        };
    }
    Logger.format = LogFormat.PLAIN;
}

export interface SimulatedBridge {
    readonly manualPairingCode: string;
    readonly close: () => Promise<void>;
}

export interface SimulatedDevice {
    /** The 11-digit code a user would read off the device's label. */
    readonly manualPairingCode: string;
    /** The `MT:` payload the same label carries as a QR image. */
    readonly qrPairingCode: string;
    /** Whether the light is on, read from the device's own state rather than through the hub. */
    readonly isOn: () => boolean;
    readonly close: () => Promise<void>;
}

/**
 * An On/Off light announcing itself the way a physical one would: a second ServerNode alongside
 * the hub's controller, in this process rather than the hub's. They find each other over mDNS,
 * which is the point — the hub has to discover this device the way it discovers any other.
 *
 * Not confined to an interface. Matter carries mDNS over IPv6 multicast and Linux's loopback does
 * not carry multicast, so pinning both sides to it works on macOS and hangs on a Linux runner at
 * the first test needing discovery — the tests that only speak TCP pass, which is what makes that
 * failure confusing. A run therefore advertises its devices on whatever network it is on.
 */
export async function startDevice(t: TestContext): Promise<SimulatedDevice> {
    configureSdk();

    const device = await ServerNode.create({
        id: uniqueId("e2e-light"),
        network: { port: DEVICE_PORT },
        commissioning: { passcode: PASSCODE, discriminator: DISCRIMINATOR },
        basicInformation: {
            vendorName: "HomeChip",
            vendorId: VendorId(0xfff1),
            productName: "E2E Test Light",
            productId: 0x8000,
            nodeLabel: "Bedside",
        },
    });
    const light = new Endpoint(OnOffLightDevice, { id: "onoff" });
    await device.add(light);
    await device.start();

    // Closed whatever the test did, since an open node holds its storage lock and its ports
    // against everything after it.
    t.after(() => device.close());

    const { manualPairingCode, qrPairingCode } = device.state.commissioning.pairingCodes;

    return {
        manualPairingCode,
        qrPairingCode,
        isOn: () => light.stateOf(OnOffLightDevice.behaviors.onOff).onOff,
        close: () => device.close(),
    };
}

/**
 * A bridge exposing two lights, which is the shape a plain device cannot produce: the bridged
 * lights hang off the aggregator endpoint rather than off the root, so a node's direct children
 * are the aggregator alone and its whole endpoint tree is the aggregator plus both lights.
 *
 * That difference is the point of the test using this. Anything that enumerates a node by its
 * direct children reports one endpoint here where there are three.
 */
export async function startBridge(t: TestContext): Promise<SimulatedBridge> {
    configureSdk();

    const bridge = await ServerNode.create({
        id: uniqueId("e2e-bridge"),
        network: { port: BRIDGE_PORT },
        commissioning: { passcode: PASSCODE, discriminator: DISCRIMINATOR + 1 },
        basicInformation: {
            vendorName: "HomeChip",
            vendorId: VendorId(0xfff1),
            productName: "E2E Test Bridge",
            productId: 0x8001,
        },
    });

    const aggregator = new Endpoint(AggregatorEndpoint, { id: "aggregator" });
    await bridge.add(aggregator);

    // A bridged device carries BridgedDeviceBasicInformation, which is how a controller tells one
    // apart from an endpoint the bridge itself implements.
    for (const id of ["bridged-1", "bridged-2"]) {
        await aggregator.add(
            new Endpoint(OnOffLightDevice.with(BridgedDeviceBasicInformationServer), {
                id,
                bridgedDeviceBasicInformation: { nodeLabel: id, productName: id, reachable: true },
            }),
        );
    }

    await bridge.start();
    t.after(() => bridge.close());

    return {
        manualPairingCode: bridge.state.commissioning.pairingCodes.manualPairingCode,
        close: () => bridge.close(),
    };
}
