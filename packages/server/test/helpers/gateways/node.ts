import type { NodeId } from "@home-chip/contract/common/ids.ts";
import { NodeNotFoundError } from "@home-chip/contract/node/errors.ts";
import type { NodeGateway } from "@home-chip/contract/node/ports.ts";
import type { CommissioningResult, NodeInfo } from "@home-chip/contract/node/types.ts";

/**
 * NodeGateway fake for the node use-case tests. commission returns a seeded
 * CommissioningResult; decommission records the ids it was called with and the force flag it
 * received, and can be made to throw (e.g. NodeNotFoundError, to exercise the fabric-absent
 * path); isReachable answers from a seeded set.
 */
export class TestNodeGateway implements NodeGateway {
    readonly decommissioned: { readonly id: NodeId; readonly force: boolean }[] = [];
    readonly #reachable = new Set<NodeId>();
    #commissionResult: CommissioningResult = {
        node: { id: "00000000-0000-7000-8000-000000000000" as NodeId, matterId: 0n },
        endpoints: [],
    };
    #decommissionError: Error | undefined;
    readonly #info = new Map<NodeId, NodeInfo>();

    setCommissionResult(result: CommissioningResult): void {
        this.#commissionResult = result;
    }

    seedInfo(info: NodeInfo): void {
        this.#info.set(info.id, info);
    }

    setReachable(id: NodeId, reachable: boolean): void {
        if (reachable) {
            this.#reachable.add(id);
        } else {
            this.#reachable.delete(id);
        }
    }

    failDecommissionWith(error: Error): void {
        this.#decommissionError = error;
    }

    async commission(_setupCode: string): Promise<CommissioningResult> {
        return this.#commissionResult;
    }

    async decommission(id: NodeId, force = false): Promise<void> {
        this.decommissioned.push({ id, force });
        if (this.#decommissionError !== undefined) {
            throw this.#decommissionError;
        }
    }

    isReachable(id: NodeId): boolean {
        return this.#reachable.has(id);
    }

    getInfo(id: NodeId): NodeInfo {
        const info = this.#info.get(id);
        if (info === undefined) {
            throw new NodeNotFoundError(id);
        }
        return info;
    }
}
