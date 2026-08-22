import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { NodeGateway } from "@home-chip/contract/node/ports.ts";
import type { NodeInfo } from "@home-chip/contract/node/types.ts";

/** Collaborators for node reads: the gateway that reaches the SDK. */
export interface NodeDeps {
    readonly nodeGateway: NodeGateway;
}

/**
 * Node metadata, straight from the gateway. It touches neither the database nor the bus, so the
 * class holds neither, and errors from the SDK — unknown id above all — propagate unchanged.
 *
 * Commissioning and decommissioning are node operations too but keep their own classes: they
 * orchestrate a transaction with a compensating rollback, and folding them in would hand this
 * passthrough a repository, a transactor and a bus it never uses.
 */
export class NodeUseCase {
    readonly #nodeGateway: NodeGateway;

    constructor(deps: NodeDeps) {
        this.#nodeGateway = deps.nodeGateway;
    }

    getInfo(id: NodeId): NodeInfo {
        return this.#nodeGateway.getInfo(id);
    }
}
