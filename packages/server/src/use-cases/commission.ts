import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { Transactor } from "@home-chip/contract/database/ports.ts";
import type { EndpointRepository, EndpointView } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointState } from "@home-chip/contract/endpoint/types.ts";
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
    readonly endpointView: EndpointView;
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
    readonly #endpointView: EndpointView;
    readonly #bus: DomainEventBus;

    constructor(deps: CommissionDeps) {
        this.#logger = deps.logger;
        this.#nodeRepository = deps.nodeRepository;
        this.#endpointRepository = deps.endpointRepository;
        this.#transactor = deps.transactor;
        this.#nodeGateway = deps.nodeGateway;
        this.#endpointView = deps.endpointView;
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
     * Composes the node's state and emits it, and is synchronous on purpose. Reports keep landing
     * until the composition, the adapter watching the node since commissioning registered it, and
     * each is in the cache the composition reads before it is announced, so the payload reflects
     * it. What must not happen is a report landing between the composition and the emit: it would
     * miss the payload and could be announced ahead of the event, to a client that does not yet
     * hold the endpoint and drops it, leaving the value from before. Making this method async is
     * the change that lets one land there, and the compiler refuses an await here until someone
     * makes it.
     *
     * Each endpoint is composed by the view that answers `endpoint.get`, so the event and every
     * read agree by construction rather than by keeping two compositions in step. An endpoint the
     * view cannot resolve comes back null and is left out, as `endpoint.list` leaves it out,
     * rather than withholding an event whose node is already recorded.
     */
    #announce(result: CommissioningResult): void {
        const nodeId = result.node.id;
        const endpoints: EndpointState[] = [];
        for (const record of result.endpoints) {
            const state = this.#endpointView.get(record.id);
            if (state !== null) {
                endpoints.push(state);
            }
        }
        this.#bus.emit("node:added", {
            node: { id: nodeId, reachable: this.#nodeGateway.isReachable(nodeId) },
            endpoints,
            timestamp: Date.now(),
        });
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
