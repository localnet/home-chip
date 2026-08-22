import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { DomainEventBus } from "@home-chip/contract/events.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import { NodeNotFoundError } from "@home-chip/contract/node/errors.ts";
import type { NodeGateway, NodeRepository } from "@home-chip/contract/node/ports.ts";

/** Collaborators for decommissioning a node. */
export interface DecommissionDeps {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly nodeGateway: NodeGateway;
    readonly bus: DomainEventBus;
}

/**
 * Decommissions a node: removes it from the fabric, then deletes it — its endpoints going with it
 * through the database cascade — and emits `node:removed`.
 *
 * Three deliberate points:
 *
 *   - A node already absent from the fabric is tolerated. The gateway reports one the SDK no
 *     longer holds, and treating that as "already gone" rather than as a failure makes the
 *     operation repeatable and gives the only removal path for a node left in the database by a
 *     partial decommission.
 *
 *   - No compensation, unlike commissioning. A database delete that fails after the fabric
 *     removal leaves the node visible and offline with nothing lost, which is recoverable where
 *     a fabric orphan is not, and re-joining the fabric to undo is impossible anyway. The
 *     divergence is logged, the error surfaces, and a retry heals through the tolerance above.
 *
 *   - `force` changes only the fabric side, where the gateway drops the node locally instead of
 *     removing our fabric from the device. Everything after is identical, which is why it threads
 *     straight through.
 */
export class DecommissionUseCase {
    readonly #logger: Logger;
    readonly #nodeRepository: NodeRepository;
    readonly #nodeGateway: NodeGateway;
    readonly #bus: DomainEventBus;

    constructor(deps: DecommissionDeps) {
        this.#logger = deps.logger;
        this.#nodeRepository = deps.nodeRepository;
        this.#nodeGateway = deps.nodeGateway;
        this.#bus = deps.bus;
    }

    async execute(id: NodeId, force = false): Promise<void> {
        // Establish the node exists in our world first, so an unknown id is a clean
        // NodeNotFoundError and never produces a phantom node:removed event.
        if (this.#nodeRepository.findById(id) === null) {
            throw new NodeNotFoundError(id);
        }

        try {
            await this.#nodeGateway.decommission(id, force);
        } catch (error) {
            if (!(error instanceof NodeNotFoundError)) {
                throw error;
            }
            this.#logger.notice("node already absent from fabric, removing from database only", id);
        }

        try {
            this.#nodeRepository.delete(id);
        } catch (error) {
            // Gone from the fabric, still persisted, so it will show offline. The fabric removal
            // cannot be undone, so the divergence is logged and the error surfaces; a retry heals
            // through the tolerance above.
            this.#logger.error("node removed from fabric but database delete failed", id, error);
            throw error;
        }

        this.#bus.emit("node:removed", { nodeId: id, timestamp: Date.now() });
    }
}
