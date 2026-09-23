import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { Transactor } from "@home-chip/contract/database/ports.ts";
import type { EndpointGateway, EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointRecord, EndpointShape, EndpointState } from "@home-chip/contract/endpoint/types.ts";
import type { DomainEventBus } from "@home-chip/contract/events.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import type { NodeGateway, NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { CommissioningResult } from "@home-chip/contract/node/types.ts";

/** Collaborators for commissioning a node. */
export interface CommissionDeps {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly endpointRepository: EndpointRepository;
    readonly transactor: Transactor;
    readonly nodeGateway: NodeGateway;
    readonly endpointGateway: EndpointGateway;
    readonly bus: DomainEventBus;
}

/**
 * Commissions a Matter device and records it. Two systems have to end up consistent, the fabric
 * and the database, so the order is fixed and the failure path compensates:
 *
 *   1. The device joins the fabric, which is what yields its matterId, so it comes first.
 *   2. The node and its endpoints are saved in one transaction, all or nothing.
 *   3. Only `node:added` is emitted, carrying the node and its endpoints' state so a client
 *      renders it without asking: `endpoint:added` is for endpoints that appear on a bridge later.
 *
 * A transaction that fails after the device joined would leave a fabric orphan — commissioned,
 * absent from the database, so invisible and uncontrollable — hence the compensating
 * decommission. If that fails too, the divergence is logged and the persistence error is what
 * surfaces: the client needs to know why the commission failed, not why undoing it did.
 */
export class CommissionUseCase {
    readonly #logger: Logger;
    readonly #nodeRepository: NodeRepository;
    readonly #endpointRepository: EndpointRepository;
    readonly #transactor: Transactor;
    readonly #nodeGateway: NodeGateway;
    readonly #endpointGateway: EndpointGateway;
    readonly #bus: DomainEventBus;

    constructor(deps: CommissionDeps) {
        this.#logger = deps.logger;
        this.#nodeRepository = deps.nodeRepository;
        this.#endpointRepository = deps.endpointRepository;
        this.#transactor = deps.transactor;
        this.#nodeGateway = deps.nodeGateway;
        this.#endpointGateway = deps.endpointGateway;
        this.#bus = deps.bus;
    }

    async execute(setupCode: string): Promise<NodeId> {
        const result = await this.#nodeGateway.commission(setupCode);
        const nodeId = result.node.id;

        try {
            this.#transactor.run(() => {
                this.#nodeRepository.save(result.node);
                for (const endpoint of result.endpoints) {
                    this.#endpointRepository.save(endpoint);
                }
            });
        } catch (error) {
            // A handled failure, not an anomaly: the rollback below leaves the node absent from
            // both sides, and the client learns of it through the propagated error.
            this.#logger.warn("commission persistence failed, rolling back", nodeId, error);
            await this.#rollbackCommission(nodeId);
            throw error;
        }

        // The repositories already hold the node when the event fires, so a consumer can trust
        // it is queryable.
        this.#announce(result);
        return nodeId;
    }

    /**
     * Composes the node's state and emits it, and is synchronous on purpose. The payload is
     * current as of the event only because no attribute report can land between the composition
     * and the emit: every one lands after, and so reaches a client after the endpoint it concerns.
     * An await in between would let a report slip through first; the client, not yet holding the
     * endpoint, would drop it, and the payload would carry the value from before. Making this
     * method async is the change that breaks the guarantee, and the compiler refuses an await
     * here until someone makes it.
     */
    #announce(result: CommissioningResult): void {
        const nodeId = result.node.id;
        this.#bus.emit("node:added", {
            node: { id: nodeId, reachable: this.#nodeGateway.isReachable(nodeId) },
            endpoints: this.#composeEndpoints(result.endpoints),
            timestamp: Date.now(),
        });
    }

    /**
     * The merge `ComposedEndpointView` makes for `endpoint.list`, repeated rather than shared: the
     * one shared form would be a method on the view's port with this as its only caller, a
     * normative surface to undo if it proves wrong, where this is private. A change to either
     * belongs in both, and the e2e commissioning test checks they agree. Worth revisiting once
     * dynamic bridge composition gives `endpoint:added` a composer of its own.
     *
     * An endpoint that cannot be resolved is left out, as the view leaves it out, rather than
     * failing an event whose node is already recorded. Here it means more than it does there:
     * the identity was registered moments ago from the very structure describe reads, so a miss
     * is an SDK invariant broken, not the fabric and the database drifting apart, hence error.
     */
    #composeEndpoints(records: readonly EndpointRecord[]): EndpointState[] {
        const states: EndpointState[] = [];
        for (const record of records) {
            let shape: EndpointShape;
            try {
                shape = this.#endpointGateway.describe(record.id);
            } catch (error) {
                this.#logger.error("commissioned endpoint unresolvable, left out of node:added", record.id, error);
                continue;
            }
            states.push({
                id: record.id,
                nodeId: record.nodeId,
                deviceType: shape.deviceType,
                name: record.name,
                roomId: record.roomId,
                clusters: shape.clusters,
            });
        }
        return states;
    }

    async #rollbackCommission(nodeId: NodeId): Promise<void> {
        try {
            await this.#nodeGateway.decommission(nodeId);
        } catch (error) {
            // The node is now an orphan, present in the fabric and absent from the database: a
            // divergence needing a factory reset, hence error rather than warn. What triggered
            // the rollback is logged separately by execute.
            this.#logger.error("commission rollback failed, node orphaned in fabric", nodeId, error);
        }
    }
}
