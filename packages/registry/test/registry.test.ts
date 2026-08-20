import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { EndpointId, NodeId, RoomId } from "@home-chip/contract/common/ids.ts";

import { createRegistry } from "../src/registry.ts";
import { TestEndpointGateway } from "./helpers/gateways/endpoint.ts";
import { TestNodeGateway } from "./helpers/gateways/node.ts";
import { TestLogger } from "./helpers/logger.ts";
import { TestEndpointRepository } from "./helpers/repositories/endpoint.ts";
import { TestNodeRepository } from "./helpers/repositories/node.ts";
import { TestRoomRepository } from "./helpers/repositories/room.ts";

describe("createRegistry", () => {
    test("gives each view its own repository and gateway", () => {
        // The entry point only has to connect the three; what each composes, and how it copes
        // with a source that cannot answer, belongs to views/*.test.ts. One reading per view is
        // enough to catch a crossed wire.
        const nodeRepository = new TestNodeRepository();
        const endpointRepository = new TestEndpointRepository();
        const roomRepository = new TestRoomRepository();
        const nodeGateway = new TestNodeGateway();
        const endpointGateway = new TestEndpointGateway();

        nodeRepository.seed({ id: "n1" as NodeId, matterId: 10n });
        nodeGateway.setReachable("n1" as NodeId, true);
        endpointRepository.seed({
            id: "e1" as EndpointId,
            nodeId: "n1" as NodeId,
            matterNumber: 1,
            name: "Light",
            roomId: null,
        });
        endpointGateway.seed("e1" as EndpointId, { deviceType: 256, clusters: [] });
        roomRepository.seed({ id: "r1" as RoomId, name: "Kitchen" });

        const registry = createRegistry({
            logger: new TestLogger(),
            nodeRepository,
            endpointRepository,
            roomRepository,
            nodeGateway,
            endpointGateway,
        });

        assert.deepEqual(registry.node.list(), [{ id: "n1", reachable: true }]);
        assert.deepEqual(registry.room.list(), [{ id: "r1", name: "Kitchen" }]);
        assert.equal(registry.endpoint.list()[0]?.name, "Light");
        assert.equal(registry.endpoint.list()[0]?.deviceType, 256);
    });
});
