import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { NodeGateway, NodeRepository, NodeView } from "@home-chip/contract/node/ports.ts";
import type { NodeRecord, NodeState } from "@home-chip/contract/node/types.ts";

/**
 * Composed on demand: a node's identity from the database, its `reachable` flag from the matter
 * adapter. Nothing is held here, so every read takes current values from both sources and the
 * view cannot drift from either.
 *
 * Composition cannot fail. `isReachable` answers false for a node the SDK does not hold, so one
 * that is persisted but unmapped is reported offline rather than omitted.
 */
export class ComposedNodeView implements NodeView {
    readonly #nodeRepository: NodeRepository;
    readonly #nodeGateway: NodeGateway;

    constructor(nodeRepository: NodeRepository, nodeGateway: NodeGateway) {
        this.#nodeRepository = nodeRepository;
        this.#nodeGateway = nodeGateway;
    }

    list(): NodeState[] {
        return this.#nodeRepository.findAll().map((record) => this.#compose(record));
    }

    get(id: NodeId): NodeState | null {
        const record = this.#nodeRepository.findById(id);
        return record === null ? null : this.#compose(record);
    }

    #compose(record: NodeRecord): NodeState {
        return { id: record.id, reachable: this.#nodeGateway.isReachable(record.id) };
    }
}
