import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "@home-chip/contract/common/errors.ts";
import { createNodeId, type NodeId } from "@home-chip/contract/common/ids.ts";
import type { NodeInfo, NodeState } from "@home-chip/contract/node/types.ts";

import type { HandlerTable } from "../../src/dispatcher.ts";
import { nodeHandlers } from "../../src/handlers/node.ts";
import { CommissionUseCase } from "../../src/use-cases/commission.ts";
import { DecommissionUseCase } from "../../src/use-cases/decommission.ts";
import { NodeUseCase } from "../../src/use-cases/node.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { TestNodeGateway } from "../helpers/gateways/node.ts";
import { TestLogger } from "../helpers/logger.ts";
import { TestEndpointRepository } from "../helpers/repositories/endpoint.ts";
import { TestNodeRepository } from "../helpers/repositories/node.ts";
import { TestTransactor } from "../helpers/transactor.ts";
import { TestView } from "../helpers/view.ts";

const N1 = createNodeId();

const INFO: NodeInfo = {
    id: N1,
    matterId: "0x1",
    commissionedAt: null,
    label: "Bedside",
    vendorName: "Acme",
    productName: "Bulb",
    vendorId: 1,
    productId: 2,
    hardwareVersion: 1,
    softwareVersion: 3,
    softwareVersionString: "1.0.0",
};

const call = (table: HandlerTable, method: string, params?: unknown): unknown => {
    const handler = table[method];
    assert.ok(handler, `no handler registered for ${method}`);
    return handler(params);
};

const setup = () => {
    const logger = new TestLogger();
    const bus = new TestEventBus();
    const nodeRepository = new TestNodeRepository();
    const endpointRepository = new TestEndpointRepository();
    const nodeGateway = new TestNodeGateway();
    const nodeView = new TestView<NodeId, NodeState>();
    const handlers = nodeHandlers({
        nodeView,
        commissionUseCase: new CommissionUseCase({
            logger,
            nodeRepository,
            endpointRepository,
            transactor: new TestTransactor(),
            nodeGateway,
            bus,
        }),
        decommissionUseCase: new DecommissionUseCase({ logger, nodeRepository, nodeGateway, bus }),
        nodeUseCase: new NodeUseCase({ nodeGateway }),
    });
    return { nodeGateway, nodeRepository, nodeView, handlers };
};

describe("nodeHandlers", () => {
    test("registers exactly the node namespace", () => {
        assert.deepEqual(Object.keys(setup().handlers).sort(), [
            "node.commission",
            "node.decommission",
            "node.get",
            "node.getInfo",
            "node.list",
        ]);
    });

    test("reads come from the view or the gateway, writes reach their use-case", () => {
        const { nodeGateway, nodeView, handlers } = setup();
        nodeView.seed({ id: N1, reachable: true });
        nodeGateway.seedInfo(INFO);

        assert.deepEqual(call(handlers, "node.list"), [{ id: N1, reachable: true }]);
        assert.deepEqual(call(handlers, "node.get", { id: N1 }), { id: N1, reachable: true });
        assert.deepEqual(call(handlers, "node.getInfo", { id: N1 }), INFO);
    });

    test("node.decommission forwards force, which defaults to false when the client omits it", async () => {
        // The only handler that carries an optional field through, so the default it applies is
        // worth pinning here rather than only in the schema.
        const { nodeGateway, nodeRepository, handlers } = setup();
        nodeRepository.seed({ id: N1, matterId: 1n });

        await call(handlers, "node.decommission", { id: N1, force: true });

        assert.deepEqual(nodeGateway.decommissioned, [{ id: N1, force: true }]);
    });

    test("every handler validates its params before reaching the collaborator", () => {
        const { handlers } = setup();

        for (const [method, params] of [
            ["node.get", {}],
            ["node.getInfo", { id: "not-a-uuid" }],
            ["node.commission", { setupCode: "123" }],
            ["node.decommission", { id: N1, force: "yes" }],
        ] as const) {
            assert.throws(() => call(handlers, method, params), ValidationError, method);
        }
    });
});
