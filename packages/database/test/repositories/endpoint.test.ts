import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import type { EndpointId, NodeId, RoomId } from "@home-chip/contract/common/ids.ts";
import { EndpointNotFoundError } from "@home-chip/contract/endpoint/errors.ts";
import type { EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@home-chip/contract/endpoint/types.ts";
import type { NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";

import { createDatabaseProvider, type DatabaseProvider } from "../../src/database.ts";
import { TestLogger } from "../helpers/logger.ts";

const endpoint = (
    id: string,
    nodeId: string,
    matterNumber: number,
    name: string,
    roomId: string | null = null,
): EndpointRecord => ({
    id: id as EndpointId,
    nodeId: nodeId as NodeId,
    matterNumber,
    name,
    roomId: roomId as RoomId | null,
});

describe("SqliteEndpointRepository", () => {
    let provider: DatabaseProvider;
    let node: NodeRepository;
    let room: RoomRepository;
    let repository: EndpointRepository;

    beforeEach(async () => {
        const path = join(mkdtempSync(join(tmpdir(), "home-chip-endpoint-")), "home-chip.db");
        provider = createDatabaseProvider(path, new TestLogger());
        await provider.start();
        node = provider.node;
        room = provider.room;
        repository = provider.endpoint;
        // The foreign key requires a parent node, which every test below needs.
        node.save({ id: "n1" as NodeId, matterId: 1n });
    });

    afterEach(async () => {
        await provider.stop();
    });

    test("round-trips a record, with a room and without one", () => {
        room.save({ id: "r1" as RoomId, name: "Kitchen" });
        const unassigned = endpoint("e1", "n1", 1, "Light");
        const assigned = endpoint("e2", "n1", 2, "Lamp", "r1");

        repository.save(unassigned);
        repository.save(assigned);

        assert.deepEqual(repository.findById("e1" as EndpointId), unassigned);
        assert.deepEqual(repository.findById("e2" as EndpointId), assigned);
    });

    test("findByMatterNumber is scoped to the node", () => {
        repository.save(endpoint("e1", "n1", 5, "Light"));

        assert.equal(repository.findByMatterNumber("n1" as NodeId, 5)?.id, "e1");
        assert.equal(repository.findByMatterNumber("n1" as NodeId, 99), null);
        assert.equal(repository.findByMatterNumber("other" as NodeId, 5), null);
    });

    test("findByNode returns that node's endpoints alone, ordered by number", () => {
        node.save({ id: "n2" as NodeId, matterId: 2n });
        repository.save(endpoint("e2", "n1", 2, "B"));
        repository.save(endpoint("e1", "n1", 1, "A"));
        repository.save(endpoint("e3", "n2", 1, "C"));

        assert.deepEqual(
            repository.findByNode("n1" as NodeId).map((found) => found.id),
            ["e1", "e2"],
        );
    });

    test("setName replaces the name and leaves the rest alone", () => {
        repository.save(endpoint("e1", "n1", 1, "Old"));

        repository.setName("e1" as EndpointId, "New");

        assert.deepEqual(repository.findById("e1" as EndpointId), endpoint("e1", "n1", 1, "New"));
    });

    test("setRoom assigns a room and clears it again", () => {
        room.save({ id: "r1" as RoomId, name: "Kitchen" });
        repository.save(endpoint("e1", "n1", 1, "Light"));

        repository.setRoom("e1" as EndpointId, "r1" as RoomId);
        assert.equal(repository.findById("e1" as EndpointId)?.roomId, "r1");

        repository.setRoom("e1" as EndpointId, null);
        assert.equal(repository.findById("e1" as EndpointId)?.roomId, null);
    });

    test("every mutator reports an id that matches nothing", () => {
        const missing = "missing" as EndpointId;

        assert.throws(() => repository.setName(missing, "x"), EndpointNotFoundError);
        assert.throws(() => repository.setRoom(missing, null), EndpointNotFoundError);
        assert.throws(() => repository.delete(missing), EndpointNotFoundError);
    });

    test("deleting the parent node takes its endpoints with it", () => {
        repository.save(endpoint("e1", "n1", 1, "Light"));

        node.delete("n1" as NodeId);

        assert.equal(repository.findById("e1" as EndpointId), null);
    });

    test("deleting a room clears the assignment rather than the endpoint", () => {
        room.save({ id: "r1" as RoomId, name: "Kitchen" });
        repository.save(endpoint("e1", "n1", 1, "Light", "r1"));

        room.delete("r1" as RoomId);

        assert.equal(repository.findById("e1" as EndpointId)?.roomId, null);
    });
});
