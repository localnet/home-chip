import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { type Snapshot, SUBSCRIBE_METHOD } from "@home-chip/contract/snapshot.ts";

import { call, connect, opened } from "./helpers/client.ts";
import { startHub } from "./helpers/hub.ts";

/**
 * A real client against a hub that actually booted: the snapshot, and a round trip through the
 * dispatcher. What each layer does is the server package's to test, the handshake included, over
 * a real socket; what this adds is that the layers are wired to each other, to the database and
 * to the Matter gateways. The token from the environment reaching the server is covered by every
 * test here connecting at all.
 */
describe("client session", () => {
    test("answers hub.subscribe with a snapshot of all three collections", async (t) => {
        const hub = await startHub(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);

        const snapshot = (await call(ws, SUBSCRIBE_METHOD)) as Snapshot;

        // Empty on a fresh hub, but present: the three views were composed and reachable, which
        // is the registry, the database and the matter gateways all answering.
        assert.deepEqual(snapshot, { nodes: [], endpoints: [], rooms: [] });
    });

    test("routes a request through the dispatcher and back", async (t) => {
        const hub = await startHub(t);
        const ws = connect(hub.url);
        t.after(() => ws.close());
        await opened(ws);

        const created = await call(ws, "room.add", { name: "Kitchen" }, "add");
        const listed = await call(ws, "room.list", {}, "list");

        // The write reached SQLite and the read came back through the room view, so the whole
        // path — transport, dispatcher, handler, use-case, repository — is connected.
        assert.deepEqual(listed, [{ id: created, name: "Kitchen" }]);
    });
});
