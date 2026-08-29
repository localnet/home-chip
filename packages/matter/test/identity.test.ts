import "../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { InternalError } from "@home-chip/contract/common/errors.ts";
import type { EndpointId, NodeId } from "@home-chip/contract/common/ids.ts";
import type { ClientNode } from "@matter/main/node";

import { IdentityMap, type NodeIdentity } from "../src/identity.ts";

// The map stores and returns the ClientNode reference and never calls into it, so a tagged empty
// object stands in and the tests stay free of the SDK and the network.
const fakeNode = (tag: string): ClientNode => ({ tag }) as unknown as ClientNode;

const nodeId = (value: string): NodeId => value as NodeId;
const endpointId = (value: string): EndpointId => value as EndpointId;

const identity = (tag: string, endpoints: NodeIdentity["endpoints"]): NodeIdentity => ({
    nodeId: nodeId(tag),
    node: fakeNode(tag),
    endpoints,
});

const N1 = identity("n1", [
    { endpointId: endpointId("e1"), endpointNumber: 1 },
    { endpointId: endpointId("e2"), endpointNumber: 2 },
]);
const N2 = identity("n2", [{ endpointId: endpointId("e3"), endpointNumber: 3 }]);

describe("IdentityMap", () => {
    describe("translation", () => {
        test("answers with the node and the endpoint number, or undefined when unmapped", () => {
            const map = new IdentityMap();
            map.addNode(N1);

            assert.equal(map.getNode(nodeId("n1")), N1.node);
            assert.deepEqual(map.resolveEndpoint(endpointId("e2")), { node: N1.node, endpointNumber: 2 });
            assert.equal(map.getNode(nodeId("missing")), undefined);
            assert.equal(map.resolveEndpoint(endpointId("missing")), undefined);
        });
    });

    describe("addNode", () => {
        test("refuses a node id already mapped, leaving the entry it holds untouched", () => {
            // Overwriting would strand the previous endpoint ids: removeNode could no longer find
            // them and resolveEndpoint would answer for them with a node we no longer control.
            const map = new IdentityMap();
            map.addNode(N1);

            assert.throws(() => map.addNode(identity("n1", [])), InternalError);

            assert.equal(map.getNode(nodeId("n1")), N1.node);
            assert.deepEqual(map.resolveEndpoint(endpointId("e1")), { node: N1.node, endpointNumber: 1 });
        });

        test("takes the same node id again once it has been removed", () => {
            const map = new IdentityMap();
            map.addNode(N1);
            map.removeNode(nodeId("n1"));

            assert.doesNotThrow(() => map.addNode(identity("n1", [])));
        });
    });

    describe("removeNode", () => {
        test("takes the node's endpoints with it and leaves other nodes alone", () => {
            const map = new IdentityMap();
            map.addNode(N1);
            map.addNode(N2);

            map.removeNode(nodeId("n1"));

            assert.equal(map.getNode(nodeId("n1")), undefined);
            assert.equal(map.resolveEndpoint(endpointId("e1")), undefined);
            assert.equal(map.resolveEndpoint(endpointId("e2")), undefined);
            assert.deepEqual(map.resolveEndpoint(endpointId("e3")), { node: N2.node, endpointNumber: 3 });
        });

        test("removing a node that is not there does nothing", () => {
            const map = new IdentityMap();

            assert.doesNotThrow(() => map.removeNode(nodeId("missing")));
        });
    });

    describe("clear", () => {
        test("empties the map so a later hydration is not a duplicate", () => {
            // What a stop() followed by a start() does: without it, rehydrating the same node
            // from the repository would meet the entry left by the previous run and throw.
            const map = new IdentityMap();
            map.addNode(N1);

            map.clear();

            assert.equal(map.getNode(nodeId("n1")), undefined);
            assert.equal(map.resolveEndpoint(endpointId("e1")), undefined);
            assert.deepEqual([...map.nodeIdentities()], []);
            assert.doesNotThrow(() => map.addNode(N1));
        });
    });

    describe("notifications", () => {
        test("onAdded fires with the whole identity, and its handle stops further ones", () => {
            const map = new IdentityMap();
            const seen: NodeIdentity[] = [];
            const unsubscribe = map.onAdded((added) => seen.push(added));

            map.addNode(N1);
            unsubscribe();
            map.addNode(N2);

            assert.deepEqual(seen, [N1]);
        });

        test("onRemoved fires with the node id, and its handle stops further ones", () => {
            const map = new IdentityMap();
            map.addNode(N1);
            map.addNode(N2);
            const seen: NodeId[] = [];
            const unsubscribe = map.onRemoved((removed) => seen.push(removed));

            map.removeNode(nodeId("n1"));
            unsubscribe();
            map.removeNode(nodeId("n2"));

            assert.deepEqual(seen, [nodeId("n1")]);
        });
    });

    describe("nodeIdentities", () => {
        test("yields every mapped node with its endpoints, so a late watcher catches up", () => {
            const map = new IdentityMap();
            map.addNode(N1);
            map.addNode(N2);

            assert.deepEqual([...map.nodeIdentities()], [N1, N2]);
        });
    });
});
