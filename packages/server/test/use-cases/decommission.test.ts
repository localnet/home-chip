import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { NodeId } from "@home-chip/contract/common/ids.ts";
import { NodeNotFoundError } from "@home-chip/contract/node/errors.ts";

import { DecommissionUseCase } from "../../src/use-cases/decommission.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { TestNodeGateway } from "../helpers/gateways/node.ts";
import { TestLogger } from "../helpers/logger.ts";
import { TestNodeRepository } from "../helpers/repositories/node.ts";

const nid = (id: string): NodeId => id as NodeId;

interface Harness {
    readonly logger: TestLogger;
    readonly nodeRepository: TestNodeRepository;
    readonly nodeGateway: TestNodeGateway;
    readonly bus: TestEventBus;
    readonly useCase: DecommissionUseCase;
}

const setup = (): Harness => {
    const logger = new TestLogger();
    const nodeRepository = new TestNodeRepository();
    const nodeGateway = new TestNodeGateway();
    const bus = new TestEventBus();
    const useCase = new DecommissionUseCase({ logger, nodeRepository, nodeGateway, bus });
    return { logger, nodeRepository, nodeGateway, bus, useCase };
};

const removed = (bus: TestEventBus) => bus.emitted.filter((entry) => entry.name === "node:removed");

describe("DecommissionUseCase", () => {
    test("forwards force to the gateway, defaulting to a proper removal when the caller omits it", async () => {
        const { nodeRepository, nodeGateway, useCase } = setup();
        nodeRepository.seed({ id: nid("n1"), matterId: 10n });
        nodeRepository.seed({ id: nid("n2"), matterId: 20n });

        await useCase.execute(nid("n1"));
        await useCase.execute(nid("n2"), true);

        assert.deepEqual(nodeGateway.decommissioned, [
            { id: "n1", force: false },
            { id: "n2", force: true },
        ]);
    });

    test("removes from the fabric, deletes from the database, and emits node:removed", async () => {
        const { nodeRepository, nodeGateway, bus, useCase } = setup();
        nodeRepository.seed({ id: nid("n1"), matterId: 10n });

        await useCase.execute(nid("n1"));

        assert.deepEqual(
            nodeGateway.decommissioned.map((entry) => entry.id),
            ["n1"],
        );
        assert.equal(nodeRepository.findById(nid("n1")), null);
        assert.equal(removed(bus).length, 1);
        const event = removed(bus)[0];
        assert.ok(event);
        assert.equal((event.payload as { nodeId: NodeId }).nodeId, "n1");
    });

    test("throws NodeNotFoundError for a node absent from the database, without touching the fabric", async () => {
        const { nodeGateway, bus, useCase } = setup();

        await assert.rejects(() => useCase.execute(nid("ghost")), NodeNotFoundError);

        assert.deepEqual(nodeGateway.decommissioned, []);
        assert.equal(removed(bus).length, 0);
    });

    test("tolerates a node already absent from the fabric: deletes from the database only, and logs", async () => {
        const { logger, nodeRepository, nodeGateway, bus, useCase } = setup();
        nodeRepository.seed({ id: nid("n1"), matterId: 10n });
        nodeGateway.failDecommissionWith(new NodeNotFoundError(nid("n1")));

        await useCase.execute(nid("n1"));

        assert.equal(nodeRepository.findById(nid("n1")), null);
        assert.equal(removed(bus).length, 1);
        assert.equal(
            logger.calls.some(
                (call) =>
                    call.level === "notice" &&
                    call.values[0] === "node already absent from fabric, removing from database only",
            ),
            true,
        );
    });
});
