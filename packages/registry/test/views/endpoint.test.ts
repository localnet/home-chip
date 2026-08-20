import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { EndpointId, NodeId, RoomId } from "@home-chip/contract/common/ids.ts";
import type { EndpointShape } from "@home-chip/contract/endpoint/types.ts";

import { ComposedEndpointView } from "../../src/views/endpoint.ts";
import { TestEndpointGateway } from "../helpers/gateways/endpoint.ts";
import { TestLogger } from "../helpers/logger.ts";
import { TestEndpointRepository } from "../helpers/repositories/endpoint.ts";

const SHAPE: EndpointShape = {
    deviceType: 256,
    clusters: [{ id: 6, attributes: [{ id: 0, value: false }], acceptedCommands: [0, 1, 2] }],
};

const setup = (): {
    repository: TestEndpointRepository;
    gateway: TestEndpointGateway;
    logger: TestLogger;
    view: ComposedEndpointView;
} => {
    const repository = new TestEndpointRepository();
    const gateway = new TestEndpointGateway();
    const logger = new TestLogger();
    return { repository, gateway, logger, view: new ComposedEndpointView(logger, repository, gateway) };
};

const warned = (logger: TestLogger): boolean =>
    logger.calls.some((call) => call.level === "warn" && call.values[0] === "skipped unresolvable endpoint");

describe("ComposedEndpointView", () => {
    test("list joins the record's fields with the shape the gateway describes", () => {
        const { repository, gateway, view } = setup();
        repository.seed({
            id: "e1" as EndpointId,
            nodeId: "n1" as NodeId,
            matterNumber: 1,
            name: "Light",
            roomId: "r1" as RoomId,
        });
        gateway.seed("e1" as EndpointId, SHAPE);

        assert.deepEqual(view.list(), [
            {
                id: "e1",
                nodeId: "n1",
                deviceType: 256,
                name: "Light",
                roomId: "r1",
                clusters: SHAPE.clusters,
            },
        ]);
    });

    test("get composes one endpoint, and answers null when the record is unknown", () => {
        const { repository, gateway, view } = setup();
        repository.seed({
            id: "e1" as EndpointId,
            nodeId: "n1" as NodeId,
            matterNumber: 1,
            name: "Light",
            roomId: null,
        });
        gateway.seed("e1" as EndpointId, SHAPE);

        assert.equal(view.get("e1" as EndpointId)?.name, "Light");
        assert.equal(view.get("e1" as EndpointId)?.roomId, null);
        assert.equal(view.get("missing" as EndpointId), null);
    });

    test("drops an endpoint the gateway cannot resolve, from either method, and warns", () => {
        // One endpoint the fabric knows nothing about must not cost the caller the whole list.
        const { repository, gateway, logger, view } = setup();
        repository.seed({
            id: "e1" as EndpointId,
            nodeId: "n1" as NodeId,
            matterNumber: 1,
            name: "Light",
            roomId: null,
        });
        repository.seed({
            id: "e2" as EndpointId,
            nodeId: "n1" as NodeId,
            matterNumber: 2,
            name: "Ghost",
            roomId: null,
        });
        gateway.seed("e1" as EndpointId, SHAPE);

        assert.deepEqual(
            view.list().map((state) => state.id),
            ["e1"],
        );
        assert.equal(view.get("e2" as EndpointId), null);
        assert.equal(warned(logger), true);
    });
});
