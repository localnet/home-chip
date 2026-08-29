import "../../src/sdk-config.ts";

import {
    Crypto,
    Entropy,
    Environment,
    Logger,
    LogLevel,
    MockCrypto,
    MockStorageService,
    Network,
    NetworkSimulator,
    VendorId,
} from "@matter/main";
import { OnOffLightDevice } from "@matter/main/devices/on-off-light";
import { ServerNode } from "@matter/main/node";

/**
 * Test harness that wires a controller and simulated Matter devices onto a shared
 * in-memory network, with no real sockets, mDNS, or disk. Mirrors the SDK's own
 * mock-server-node setup but uses only @matter/main exports, so no @matter/testing
 * dependency (and its heavy transitive deps) is needed.
 *
 * Tracks every node it creates so a single close() tears them all down — leaving SDK
 * nodes running keeps timers (mDNS, MRP, subscriptions) alive and hangs the test
 * runner. Each simulated device gets a distinct passcode and discriminator so multiple
 * devices on one network do not collide during discovery.
 */
export class MatterTestNetwork {
    readonly #simulator = new NetworkSimulator();
    readonly #nodes: ServerNode[] = [];
    #hostIndex = 0;

    constructor() {
        // Production redirects the SDK's global logger through configureEnvironment;
        // tests build their own ServerNodes without it, so the SDK would otherwise dump
        // its (debug-level) output to the console and bury the test results. Raise the
        // level to FATAL to keep the runner's output readable.
        Logger.level = LogLevel.FATAL;
    }

    #environment(): Environment {
        const index = ++this.#hostIndex;
        const environment = new Environment(`test-${index}`);
        const crypto = MockCrypto(index);
        environment.set(Entropy, crypto);
        environment.set(Crypto, crypto);
        new MockStorageService(environment);
        environment.set(Network, this.#simulator.addHost(index));
        return environment;
    }

    /** Creates and starts the controller node. */
    async createController(): Promise<ServerNode> {
        const controller = await ServerNode.create({ environment: this.#environment(), id: `hub-${this.#hostIndex}` });
        await controller.start();
        this.#nodes.push(controller);
        return controller;
    }

    /** Creates and starts a simulated OnOff light, returning it and its pairing code. */
    async createOnOffLight(): Promise<{ device: ServerNode; pairingCode: string }> {
        const index = this.#hostIndex + 1;
        const device = await ServerNode.create({
            environment: this.#environment(),
            id: `device-${index}`,
            // Distinct per device so concurrent devices do not clash in discovery.
            commissioning: { passcode: 20202021 + index, discriminator: 3840 + index },
            basicInformation: {
                vendorName: "HomeChip Test",
                vendorId: VendorId(0xfff1),
                productName: "Test OnOff Light",
                productId: 0x8000,
                hardwareVersion: 1,
                softwareVersion: 1,
                softwareVersionString: "1.0.0",
            },
        });
        await device.add(OnOffLightDevice);
        await device.start();
        this.#nodes.push(device);
        return { device, pairingCode: device.state.commissioning.pairingCodes.manualPairingCode };
    }

    /** Closes every node created through this network, releasing their timers. */
    async close(): Promise<void> {
        // Close in reverse creation order so peers shut down before the controller.
        for (const node of this.#nodes.reverse()) {
            await node.close();
        }
        this.#nodes.length = 0;
    }
}
