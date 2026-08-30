import type { TestContext } from "node:test";

import { Endpoint, ServerNode, VendorId } from "@matter/main";
import { OnOffLightDevice } from "@matter/main/devices";

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

/** Passcode and discriminator the SDK itself uses for development, and the pairing codes derive. */
const PASSCODE = 20202021;
const DISCRIMINATOR = 3840;

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
 * An On/Off light announcing itself on the real network, as a physical one would: a second
 * ServerNode alongside the hub's controller. They coexist because the SDK partitions storage by
 * node id and each takes its own operational port; mDNS is shared, which is the point — the hub
 * has to discover this device the way it discovers any other.
 *
 * Started after the hub, so it inherits the storage root the hub configured and its state lands
 * under the same temporary tree, cleaned up with it.
 */
export async function startDevice(t: TestContext): Promise<SimulatedDevice> {
    const device = await ServerNode.create({
        id: "e2e-light",
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
