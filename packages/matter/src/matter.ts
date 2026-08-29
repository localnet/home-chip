// Import the SDK isolation side effect before any "@matter/main" import (see sdk-config.ts).
import "./sdk-config.ts";

import type { Writable } from "node:stream";

import { InternalError } from "@home-chip/contract/common/errors.ts";
import type { Lifecycle } from "@home-chip/contract/common/lifecycle.ts";
import type { EndpointGateway, EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { DomainEventBus } from "@home-chip/contract/events.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import type { NodeGateway, NodeRepository } from "@home-chip/contract/node/ports.ts";
import { VendorId } from "@matter/main";
import { type ClientNode, ControllerBehavior, ServerNode } from "@matter/main/node";

import { configureEnvironment, type SdkOptions } from "./environment.ts";
import { SdkEndpointGateway } from "./gateways/endpoint.ts";
import { SdkNodeGateway } from "./gateways/node.ts";
import { IdentityMap } from "./identity.ts";

// Defined beside configureEnvironment, its consumer, and re-exported here because the
// composition root passes it to createMatterProvider.
export type { SdkOptions } from "./environment.ts";

/**
 * Collaborators the provider is given: the two sinks it writes through, the bus its gateways emit
 * on, and the repositories it reads at hydration. Kept apart from the options so a test can pass
 * fakes for these and plain values for those.
 */
export interface MatterDeps {
    readonly logger: Logger;
    readonly stream: Writable;
    readonly nodeRepository: NodeRepository;
    readonly endpointRepository: EndpointRepository;
    readonly bus: DomainEventBus;
}

/**
 * Owns the Matter controller and exposes the gateways built on it. The composition root starts it
 * early and stops it last.
 *
 * Nothing from @matter/main crosses this interface: encapsulating the SDK is what the package is
 * for. The gateways live inside and reach the controller through a private field; a caller sees
 * only the contract's ports.
 */
export interface MatterProvider extends Lifecycle {
    readonly node: NodeGateway;
    readonly endpoint: EndpointGateway;
}

/**
 * The SDK node's id, local to us — what a Matter client sees comes from `basicInformation` — but
 * also the name of the directory the SDK keeps the node's storage in, so changing it strands an
 * existing hub's fabric credentials.
 *
 * Its value is the hub's component stem, shared with `hub.log`, `hub.db`, `hub.json` and
 * `matter/hub.log`. That is the convention rather than a coincidence: one stem per component
 * across every subtree.
 */
const NODE_ID = "hub";

/**
 * What the hub reports as its own identity on the fabric.
 *
 * `vendorId` is one of the test values the CSA reserves (0xFFF1-0xFFF4): a real one requires
 * Connectivity Standards Alliance membership, so it stays until HomeChip is a certified
 * vendor. It is set explicitly rather than left to the SDK's identical default because that
 * default also logs a warning on every boot, and a warning nobody can act on only teaches
 * readers to ignore warnings — the fact belongs here, read once, not in every log.
 *
 * The versions must be non-zero: the SDK treats a zero as "not set" and substitutes its own
 * development values. They are constants rather than the package version because reading
 * package.json couples us to a file layout that bundling changes; the cost is remembering to
 * raise `softwareVersion` (which must increase monotonically) on each release.
 */
const BASIC_INFORMATION = {
    vendorId: VendorId(0xfff1),
    vendorName: "HomeChip",
    productId: 0x8000,
    productName: "Hub",
    hardwareVersion: 1,
    softwareVersion: 1,
    softwareVersionString: "0.0.1",
};

class SdkMatterProvider implements MatterProvider {
    readonly #rootPath: string;
    readonly #logger: Logger;
    readonly #stream: Writable;
    readonly #nodeRepository: NodeRepository;
    readonly #endpointRepository: EndpointRepository;
    readonly #bus: DomainEventBus;
    readonly #options: SdkOptions;
    readonly #identity = new IdentityMap();
    #controller: ServerNode | undefined;
    #node: SdkNodeGateway | undefined;
    #endpoint: SdkEndpointGateway | undefined;

    constructor(rootPath: string, deps: MatterDeps, options: SdkOptions) {
        this.#rootPath = rootPath;
        this.#logger = deps.logger.get("Matter");
        this.#stream = deps.stream;
        this.#nodeRepository = deps.nodeRepository;
        this.#endpointRepository = deps.endpointRepository;
        this.#bus = deps.bus;
        this.#options = options;
    }

    // Each getter guards inline so its message names the gateway that was reached, which a shared
    // helper seeing an anonymous `T | undefined` could not do. Reaching one outside the window is
    // a wiring bug in the composition root, hence InternalError.

    get node(): NodeGateway {
        if (this.#node === undefined) {
            throw new InternalError("Node gateway accessed outside its start()/stop() window");
        }
        return this.#node;
    }

    get endpoint(): EndpointGateway {
        if (this.#endpoint === undefined) {
            throw new InternalError("Endpoint gateway accessed outside its start()/stop() window");
        }
        return this.#endpoint;
    }

    async start(): Promise<void> {
        if (this.#controller !== undefined) {
            return;
        }
        // Before creating the node, so it picks up our storage path and log redirection.
        const environment = configureEnvironment(this.#rootPath, this.#stream, this.#options);

        // ControllerBehavior is what makes a ServerNode a controller rather than a device. It
        // registers the commissionable mDNS scanner when the node comes online — the only place
        // in the SDK that adds one — and issues the wildcard query per fabric that resolves
        // already-commissioned peers. Without it there is no discovery at all: neither a device
        // to commission nor a known node to reconnect to would ever be found.
        //
        // Commissioning stays disabled because this node commissions others through `peers` and
        // must never advertise itself as commissionable. The SDK would otherwise do so on every
        // boot, an uncommissioned node with a device type entering commissionable mode — and this
        // one is uncommissioned by design. It leaves `peers.commission` alone.
        const controller = await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), {
            environment,
            id: NODE_ID,
            basicInformation: BASIC_INFORMATION,
            commissioning: { enabled: false },
            // The label our fabric carries on every device we commission, which is what a user
            // reads when another ecosystem lists a shared device's admins. It says who we are,
            // the same thing vendorName says, so it comes from there rather than from a second
            // constant that could drift. ControllerBehavior refuses to start without one, and a
            // fabric label is capped at 32 characters.
            controller: { adminFabricLabel: BASIC_INFORMATION.vendorName },
        });
        await controller.start();

        this.#hydrateIdentity(controller);
        // After hydration, so both observe the nodes the IdentityMap already holds as well as the
        // ones added later.
        this.#node = new SdkNodeGateway(this.#logger, this.#bus, this.#identity, controller);
        this.#node.start();
        this.#endpoint = new SdkEndpointGateway(this.#logger, this.#bus, this.#identity);
        this.#endpoint.start();

        this.#controller = controller;

        this.#logger.notice("controller ready", this.#rootPath);
    }

    async stop(): Promise<void> {
        if (this.#controller === undefined) {
            return;
        }
        const controller = this.#controller;

        // Stop observing before closing, and empty the identity map with them: a later start
        // rehydrates from the repository, and the nodes of this run would be duplicates.
        this.#endpoint?.stop();
        this.#endpoint = undefined;
        this.#node?.stop();
        this.#node = undefined;
        this.#identity.clear();

        await controller.close();

        this.#controller = undefined;
    }

    /**
     * Rebuilds the NodeId-to-ClientNode map after a restart. The SDK repopulates its peers from
     * its own storage; we read ours from the repository and correlate the two by matterId, the
     * uint64 the SDK exposes on each peer and the value we persisted at commissioning.
     */
    #hydrateIdentity(controller: ServerNode): void {
        const matterNodes = new Map<bigint, ClientNode>();
        for (const peer of controller.peers) {
            const peerAddress = peer.state.commissioning.peerAddress;
            if (peerAddress !== undefined) {
                matterNodes.set(peerAddress.nodeId, peer);
            }
        }

        for (const record of this.#nodeRepository.findAll()) {
            const peer = matterNodes.get(record.matterId);
            if (peer === undefined) {
                // A persisted node the SDK has no peer for: fabric and database have diverged,
                // storage restored from different backups being the usual way. Skipped rather
                // than failing the boot; the node is simply not controllable.
                this.#logger.warn("persisted node has no Matter peer", record.id);
                continue;
            }
            const endpoints = this.#endpointRepository.findByNode(record.id).map((endpoint) => ({
                endpointId: endpoint.id,
                endpointNumber: endpoint.matterNumber,
            }));
            this.#identity.addNode({ nodeId: record.id, node: peer, endpoints });
        }
    }
}

export function createMatterProvider(rootPath: string, deps: MatterDeps, options: SdkOptions): MatterProvider {
    return new SdkMatterProvider(rootPath, deps, options);
}
