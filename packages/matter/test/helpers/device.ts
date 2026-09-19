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

    /**
     * Creates and starts a simulated OnOff light, returning it, its pairing code and the number
     * the SDK gave its light endpoint. `names` overrides the NodeLabel (empty by default) and the
     * ProductName the device reports.
     */
    async createOnOffLight(
        names: { readonly nodeLabel?: string; readonly productName?: string } = {},
    ): Promise<{ device: ServerNode; pairingCode: string; endpointNumber: number }> {
        const index = this.#hostIndex + 1;
        const device = await ServerNode.create({
            environment: this.#environment(),
            id: `device-${index}`,
            // Distinct per device so concurrent devices do not clash in discovery.
            commissioning: { passcode: 20202021 + index, discriminator: 3840 + index },
            // Every number distinct, so a reading that crossed two of them would show.
            basicInformation: {
                vendorName: "HomeChip Test",
                vendorId: VendorId(0xfff1),
                productName: names.productName ?? "Test OnOff Light",
                nodeLabel: names.nodeLabel ?? "",
                productId: 0x8000,
                hardwareVersion: 2,
                softwareVersion: 3,
                softwareVersionString: "3.0.0",
            },
        });
        const light = await device.add(OnOffLightDevice);
        await device.start();
        this.#nodes.push(device);
        return {
            device,
            pairingCode: device.state.commissioning.pairingCodes.manualPairingCode,
            endpointNumber: light.number,
        };
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
