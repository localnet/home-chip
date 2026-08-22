import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { createNodeId } from "@home-chip/contract/common/ids.ts";
import { NodeNotFoundError } from "@home-chip/contract/node/errors.ts";
import type { NodeInfo } from "@home-chip/contract/node/types.ts";

import { NodeUseCase } from "../../src/use-cases/node.ts";
import { TestNodeGateway } from "../helpers/gateways/node.ts";

const N1 = createNodeId();

describe("NodeUseCase", () => {
    test("getInfo returns what the gateway holds, and passes its failure on", () => {
        const nodeGateway = new TestNodeGateway();
        const useCase = new NodeUseCase({ nodeGateway });
        const info: NodeInfo = {
            id: N1,
            matterId: "1",
            commissionedAt: 1700000000000,
            label: "Bedside",
            vendorName: "Acme",
            productName: "Bulb",
            vendorId: 1,
            productId: 2,
            hardwareVersion: 1,
            softwareVersion: 3,
            softwareVersionString: "1.0.0",
        };
        nodeGateway.seedInfo(info);

        assert.deepEqual(useCase.getInfo(N1), info);
        assert.throws(() => useCase.getInfo(createNodeId()), NodeNotFoundError);
    });
});
