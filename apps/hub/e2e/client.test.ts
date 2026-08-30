import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { JsonRpcErrorCode } from "@home-chip/contract/server/types.ts";
import { type Snapshot, SUBSCRIBE_METHOD } from "@home-chip/contract/snapshot.ts";

import { connect, opened, refusedUpgrade, request } from "./helpers/client.ts";
import { startHub } from "./helpers/hub.ts";

/**
 * A real client against a real socket: the handshake, the snapshot, and a round trip through the
 * dispatcher. What each layer does in isolation is covered by the server package; what this adds
 * is that they are wired to each other and to a hub that actually booted.
 */
describe("client session", () => {
    test("accepts a handshake carrying the token and the schema version", async (t) => {
        const hub = await startHub(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());

        await assert.doesNotReject(() => opened(ws));

        // Echoed back, without which a browser refuses a subprotocol it did not offer.
        assert.equal(ws.protocol, hub.environment.authToken);
    });

    test("refuses a bad token with 401 and an unspoken schema version with 426", async (t) => {
        const hub = await startHub(t);

        // Answered before the socket opens, so a client learns why rather than seeing a
        // connection drop. Two distinct codes because the remedies differ: fix the secret, or
        // speak a schema this hub serves.
        assert.equal(await refusedUpgrade(hub.url, { token: "not-the-token" }), 401);
        assert.equal(await refusedUpgrade(hub.url, { version: null }), 426);
    });

    test("answers hub.subscribe with a snapshot of all three collections", async (t) => {
        const hub = await startHub(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);

        const response = await request(ws, SUBSCRIBE_METHOD);

        assert.ok("result" in response);
        // Empty on a fresh hub, but present: the three views were composed and reachable, which
        // is the registry, the database and the matter gateways all answering.
        assert.deepEqual(response.result as Snapshot, { nodes: [], endpoints: [], rooms: [] });
    });

    test("routes a request through the dispatcher and back", async (t) => {
        const hub = await startHub(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);

        const created = await request(ws, "room.add", { name: "Kitchen" }, "add");
        const listed = await request(ws, "room.list", {}, "list");

        assert.ok("result" in created);
        assert.ok("result" in listed);
        // The write reached SQLite and the read came back through the room view, so the whole
        // path — transport, dispatcher, handler, use-case, repository — is connected.
        assert.deepEqual(listed.result, [{ id: created.result, name: "Kitchen" }]);
    });

    test("answers an unknown method with MethodNotFound rather than dropping the socket", async (t) => {
        const hub = await startHub(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);

        const response = await request(ws, "room.nope", {});

        assert.ok("error" in response);
        assert.equal(response.error.code, JsonRpcErrorCode.MethodNotFound);
    });
});
