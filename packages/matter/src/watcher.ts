// Import the SDK isolation side effect before any "@matter/main" import (see sdk-config.ts).
import "./sdk-config.ts";

import type { Unsubscribe } from "@home-chip/contract/common/bus.ts";
import type { NodeId } from "@home-chip/contract/common/ids.ts";
import { ObserverGroup } from "@matter/main";

import type { IdentityMap, NodeIdentity } from "./identity.ts";

/**
 * Attaches the observers a gateway wants for one node. Everything registered on `group` is
 * released together when that node goes away or the gateway stops, so an implementation only
 * has to decide *what* to observe.
 */
export type AttachToNode = (group: ObserverGroup, identity: NodeIdentity) => void;

/**
 * Keeps a gateway's SDK observers alive for exactly as long as the nodes they belong to.
 *
 * Both gateways need the same bookkeeping — observe every node the IdentityMap holds, observe
 * each one added later, detach when a node is removed or the gateway stops — and the SDK makes it
 * mandatory rather than optional: `Observable.on()` hands back no unsubscribe handle, only an
 * ObserverGroup can detach, and a decommissioned node's ClientNode stays alive, so observers left
 * attached would outlive the node they were registered for.
 *
 * The gateways differ only in what they observe, which is the `attach` callback. Everything else
 * lives here, so a fix to the lifetime rules lands once instead of twice.
 */
export class NodeWatcher {
    readonly #identity: IdentityMap;
    readonly #attach: AttachToNode;
    readonly #groups = new Map<NodeId, ObserverGroup>();
    readonly #unsubscribes: Unsubscribe[] = [];

    constructor(identity: IdentityMap, attach: AttachToNode) {
        this.#identity = identity;
        this.#attach = attach;
    }

    /**
     * Begins observing. Subscribes to IdentityMap additions so a newly commissioned node is
     * observed as soon as commissioning registers it, and to removals so a decommissioned node's
     * observers are released. Also observes every node already mapped — the ones rehydrated at
     * start, before these subscriptions existed.
     *
     * A second call returns: subscribing the IdentityMap again would leave the first
     * subscriptions beyond the reach of stop().
     */
    start(): void {
        if (this.#unsubscribes.length > 0) {
            return;
        }
        this.#unsubscribes.push(
            this.#identity.onAdded((identity) => this.#watch(identity)),
            this.#identity.onRemoved((nodeId) => this.#unwatch(nodeId)),
        );
        for (const identity of this.#identity.nodeIdentities()) {
            this.#watch(identity);
        }
    }

    /**
     * Stops observing: releases the IdentityMap subscriptions and detaches every node's
     * observers. Idempotent, and safe before start().
     */
    stop(): void {
        for (const unsubscribe of this.#unsubscribes) {
            unsubscribe();
        }
        this.#unsubscribes.length = 0;
        for (const nodeId of [...this.#groups.keys()]) {
            this.#unwatch(nodeId);
        }
    }

    /**
     * Watches a node. A node can only be watched once: IdentityMap rejects an id that is already
     * mapped and start() is idempotent, so nothing reaches this twice for the same node without
     * a removal in between — and a removal releases the group through `#unwatch` first.
     */
    #watch(identity: NodeIdentity): void {
        const group = new ObserverGroup();
        this.#groups.set(identity.nodeId, group);
        this.#attach(group, identity);
    }

    #unwatch(nodeId: NodeId): void {
        const group = this.#groups.get(nodeId);
        if (group === undefined) {
            return;
        }
        group.close();
        this.#groups.delete(nodeId);
    }
}
