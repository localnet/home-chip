import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { NodeId } from "@home-chip/contract/common/ids.ts";

import { ComposedNodeView } from "../../src/views/node.ts";
import { TestNodeGateway } from "../helpers/gateways/node.ts";
import { TestNodeRepository } from "../helpers/repositories/node.ts";

const setup = (): { repository: TestNodeRepository; gateway: TestNodeGateway; view: ComposedNodeView } => {
    const repository = new TestNodeRepository();
    const gateway = new TestNodeGateway();
    return { repository, gateway, view: new ComposedNodeView(repository, gateway) };
};

describe("ComposedNodeView", () => {
    test("list takes identity from the repository and reachability from the gateway", () => {
        const { repository, gateway, view } = setup();
        repository.seed({ id: "n1" as NodeId, matterId: 10n });
        repository.seed({ id: "n2" as NodeId, matterId: 20n });
        gateway.setReachable("n1" as NodeId, true);

        assert.deepEqual(
            [...view.list()].sort((a, b) => a.id.localeCompare(b.id)),
            [
                { id: "n1", reachable: true },
                { id: "n2", reachable: false },
            ],
        );
    });

    test("get composes one node, answers null for an unknown id, and never fails to compose", () => {
        const { repository, gateway, view } = setup();
        repository.seed({ id: "n1" as NodeId, matterId: 10n });
        repository.seed({ id: "n2" as NodeId, matterId: 20n });
        gateway.setReachable("n1" as NodeId, true);

        assert.deepEqual(view.get("n1" as NodeId), { id: "n1", reachable: true });
        assert.equal(view.get("missing" as NodeId), null);
        // n2 is persisted but the gateway holds no mapping for it: offline, not omitted.
        assert.deepEqual(view.get("n2" as NodeId), { id: "n2", reachable: false });
    });
});
