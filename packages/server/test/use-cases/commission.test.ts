import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { EndpointId, NodeId } from "@home-chip/contract/common/ids.ts";
import type { EndpointState } from "@home-chip/contract/endpoint/types.ts";
import type { CommissioningResult } from "@home-chip/contract/node/types.ts";

import { CommissionUseCase } from "../../src/use-cases/commission.ts";
import { TestEventBus } from "../helpers/bus.ts";
import { TestNodeGateway } from "../helpers/gateways/node.ts";
import { TestLogger } from "../helpers/logger.ts";
import { TestEndpointRepository } from "../helpers/repositories/endpoint.ts";
import { TestNodeRepository } from "../helpers/repositories/node.ts";
import { TestTransactor } from "../helpers/transactor.ts";
import { TestView } from "../helpers/view.ts";

const nid = (id: string): NodeId => id as NodeId;
const eid = (id: string): EndpointId => id as EndpointId;

const commissioning = (): CommissioningResult => ({
    node: { id: nid("n1"), matterId: 10n },
    endpoints: [
        { id: eid("e1"), nodeId: nid("n1"), matterNumber: 1, name: "Light", roomId: null },
        { id: eid("e2"), nodeId: nid("n1"), matterNumber: 2, name: "Light", roomId: null },
    ],
});

/** An OnOff light that is on, as the view composes it. */
const light = (id: string): EndpointState => ({
    id: eid(id),
    nodeId: nid("n1"),
    deviceType: 0x0100,
    name: "Light",
    roomId: null,
    clusters: [{ id: 0x0006, attributes: [{ id: 0x0000, value: true }], acceptedCommands: [0x00, 0x01] }],
});

interface Harness {
    readonly logger: TestLogger;
    readonly nodeRepository: TestNodeRepository;
    readonly endpointRepository: TestEndpointRepository;
    readonly transactor: TestTransactor;
    readonly nodeGateway: TestNodeGateway;
    readonly endpointView: TestView<EndpointId, EndpointState>;
    readonly bus: TestEventBus;
    readonly useCase: CommissionUseCase;
}

const setup = (): Harness => {
    const logger = new TestLogger();
    const nodeRepository = new TestNodeRepository();
    const endpointRepository = new TestEndpointRepository();
    const transactor = new TestTransactor();
    const nodeGateway = new TestNodeGateway();
    const endpointView = new TestView<EndpointId, EndpointState>();
    const bus = new TestEventBus();
    const useCase = new CommissionUseCase({
        logger,
        nodeRepository,
        endpointRepository,
        transactor,
        nodeGateway,
        endpointView,
        bus,
    });
    return { logger, nodeRepository, endpointRepository, transactor, nodeGateway, endpointView, bus, useCase };
};

const added = (bus: TestEventBus) => bus.emitted.filter((entry) => entry.name === "node:added");

describe("CommissionUseCase", () => {
    test("persists the node and endpoints, emits only node:added, and returns the node id", async () => {
        const { nodeRepository, endpointRepository, nodeGateway, endpointView, bus, useCase } = setup();
        nodeGateway.setCommissionResult(commissioning());
        // Seeded out of order: the payload follows the commissioning's records, not the view.
        endpointView.seed(light("e2"));
        endpointView.seed(light("e1"));
        // Unreachable on purpose: a node just commissioned is plausibly online, so a use-case
        // answering true without asking the gateway would pass against a gateway that said true.
        nodeGateway.setReachable(nid("n1"), false);

        const id = await useCase.execute("MT:CODE");

        assert.equal(id, "n1");
        assert.notEqual(nodeRepository.findById(nid("n1")), null);
        assert.notEqual(endpointRepository.findById(eid("e1")), null);
        assert.notEqual(endpointRepository.findById(eid("e2")), null);

        // Exactly one event: node:added, carrying the composed reachability and every endpoint's
        // state as the view composes it; no endpoint:added.
        assert.equal(bus.emitted.length, 1);
        const event = added(bus)[0];
        assert.ok(event);
        const { timestamp } = event.payload as { timestamp: number };
        assert.deepEqual(event.payload, {
            node: { id: "n1", reachable: false },
            endpoints: [light("e1"), light("e2")],
            timestamp,
        });
        assert.equal(typeof timestamp, "number");
    });

    test("leaves an endpoint the view cannot resolve out of node:added, and still announces", async () => {
        const { endpointRepository, nodeGateway, endpointView, bus, useCase } = setup();
        nodeGateway.setCommissionResult(commissioning());
        // Nothing seeded for e2: the view answers null for it, as it does for an endpoint whose
        // describe fails.
        endpointView.seed(light("e1"));

        const id = await useCase.execute("MT:CODE");

        // Recorded all the same: the event is what leaves e2 out, not the database.
        assert.equal(id, "n1");
        assert.notEqual(endpointRepository.findById(eid("e2")), null);
        const event = added(bus)[0];
        assert.ok(event);
        const { endpoints } = event.payload as { endpoints: EndpointState[] };
        assert.deepEqual(endpoints, [light("e1")]);
    });

    test("rolls back the commissioning and emits nothing when the transaction fails", async () => {
        const { logger, transactor, nodeGateway, bus, useCase } = setup();
        nodeGateway.setCommissionResult(commissioning());
        const failure = new Error("disk full");
        transactor.failWith(failure);

        await assert.rejects(() => useCase.execute("MT:CODE"), failure);

        assert.deepEqual(
            nodeGateway.decommissioned.map((entry) => entry.id),
            ["n1"],
        );
        assert.equal(added(bus).length, 0);
        assert.equal(
            logger.calls.some(
                (call) => call.level === "warn" && call.values[0] === "commission persistence failed, rolling back",
            ),
            true,
        );
    });

    test("surfaces the persistence error (not the compensation error) and logs when rollback also fails", async () => {
        const { logger, transactor, nodeGateway, bus, useCase } = setup();
        nodeGateway.setCommissionResult(commissioning());
        const persistError = new Error("disk full");
        transactor.failWith(persistError);
        nodeGateway.failDecommissionWith(new Error("device already gone"));

        await assert.rejects(() => useCase.execute("MT:CODE"), persistError);

        assert.equal(added(bus).length, 0);
        assert.equal(
            logger.calls.some(
                (call) =>
                    call.level === "error" && call.values[0] === "commission rollback failed, node orphaned in fabric",
            ),
            true,
        );
    });
});
