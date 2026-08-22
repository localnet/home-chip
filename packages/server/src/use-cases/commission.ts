import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { Transactor } from "@home-chip/contract/database/ports.ts";
import type { EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { DomainEventBus } from "@home-chip/contract/events.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import type { NodeGateway, NodeRepository } from "@home-chip/contract/node/ports.ts";

/** Collaborators for commissioning a node. */
export interface CommissionDeps {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly endpointRepository: EndpointRepository;
    readonly transactor: Transactor;
    readonly nodeGateway: NodeGateway;
    readonly bus: DomainEventBus;
}

/**
 * Commissions a Matter device and records it. Two systems have to end up consistent, the fabric
 * and the database, so the order is fixed and the failure path compensates:
 *
 *   1. The device joins the fabric, which is what yields its matterId, so it comes first.
 *   2. The node and its endpoints are saved in one transaction, all or nothing.
 *   3. Only `node:added` is emitted. The endpoints are persisted, so `endpoint.list` finds them,
 *      but not announced: `endpoint:added` is for endpoints that appear on a bridge later.
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
    readonly #bus: DomainEventBus;

    constructor(deps: CommissionDeps) {
        this.#logger = deps.logger;
        this.#nodeRepository = deps.nodeRepository;
        this.#endpointRepository = deps.endpointRepository;
        this.#transactor = deps.transactor;
        this.#nodeGateway = deps.nodeGateway;
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
        this.#bus.emit("node:added", {
            node: { id: nodeId, reachable: this.#nodeGateway.isReachable(nodeId) },
            timestamp: Date.now(),
        });
        return nodeId;
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
