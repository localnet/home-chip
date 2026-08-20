import type { NodeId } from "@home-chip/contract/common/ids.ts";
import type { NodeGateway } from "@home-chip/contract/node/ports.ts";
import type { CommissioningResult, NodeInfo } from "@home-chip/contract/node/types.ts";

// The views only ask isReachable. The rest fail loudly rather than returning a stub, so a view
// reaching for one is a test failure and not a silent pass.
const unused = (name: string): never => {
    throw new Error(`fake node gateway: ${name} is not exercised by the registry`);
};

/**
 * isReachable answers from a set of reachable ids. Anything else — including an id the fake has
 * never seen — reads as false, which is what the real gateway answers for an unmapped node.
 */
export class TestNodeGateway implements NodeGateway {
    readonly #reachable = new Set<NodeId>();

    setReachable(id: NodeId, reachable: boolean): void {
        if (reachable) {
            this.#reachable.add(id);
        } else {
            this.#reachable.delete(id);
        }
    }

    isReachable(id: NodeId): boolean {
        return this.#reachable.has(id);
    }

    commission(): Promise<CommissioningResult> {
        return unused("commission");
    }

    decommission(): Promise<void> {
        return unused("decommission");
    }

    getInfo(): NodeInfo {
        return unused("getInfo");
    }
}
