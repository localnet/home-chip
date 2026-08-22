import { strict as assert } from "node:assert";
import { createServer } from "node:net";
import { after, describe, type TestContext, test } from "node:test";

import { createNodeId, createRoomId, type NodeId } from "@home-chip/contract/common/ids.ts";
import type { NodeState } from "@home-chip/contract/node/types.ts";
import { SUBSCRIBE_METHOD } from "@home-chip/contract/snapshot.ts";
import { createEventBus } from "@home-chip/registry/bus.ts";
import { WebSocket } from "ws";

import { createServerProvider } from "../src/server.ts";
import { CommissionUseCase } from "../src/use-cases/commission.ts";
import { DecommissionUseCase } from "../src/use-cases/decommission.ts";
import { EndpointUseCase } from "../src/use-cases/endpoint.ts";
import { NodeUseCase } from "../src/use-cases/node.ts";
import { RoomUseCase } from "../src/use-cases/room.ts";
import { TestEndpointGateway } from "./helpers/gateways/endpoint.ts";
import { TestNodeGateway } from "./helpers/gateways/node.ts";
import { TestLogger } from "./helpers/logger.ts";
import { TestEndpointRepository } from "./helpers/repositories/endpoint.ts";
import { TestNodeRepository } from "./helpers/repositories/node.ts";
import { TestRoomRepository } from "./helpers/repositories/room.ts";
import { TestTransactor } from "./helpers/transactor.ts";
import { TestView } from "./helpers/view.ts";

const TOKEN = "0a1b2c3d4e5f6789"; // hex → subprotocol-safe
const N1 = createNodeId();
const R1 = createRoomId();

const freePort = (): Promise<number> =>
    new Promise((resolve, reject) => {
        const probe = createServer();
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            probe.close(() => resolve(port));
        });
    });

const setup = async (t: TestContext, options: { port?: number; start?: boolean } = {}) => {
    const logger = new TestLogger();
    const nodeRepository = new TestNodeRepository();
    const endpointRepository = new TestEndpointRepository();
    const roomRepository = new TestRoomRepository();
    const nodeGateway = new TestNodeGateway();
    const endpointGateway = new TestEndpointGateway();
    const bus = createEventBus(new TestLogger());
    const nodeView = new TestView<NodeId, NodeState>();
    const port = options.port ?? (await freePort());
    const server = createServerProvider(
        {
            nodeView,
            endpointView: new TestView(),
            roomView: new TestView(),
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
            endpointUseCase: new EndpointUseCase({ endpointRepository, roomRepository, endpointGateway, bus }),
            roomUseCase: new RoomUseCase({ roomRepository, bus }),
            bus,
            logger,
        },
        { authToken: TOKEN, host: "127.0.0.1", port },
    );
    if (options.start !== false) {
        await server.start();
    }
    t.after(() => server.stop());
    return { bus, nodeView, port, server };
};

const connect = (port: number, token: string, version = "1"): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?v=${version}`, [token]);
        ws.on("open", () => resolve(ws));
        ws.on("error", reject);
    });

const nextMessage = (ws: WebSocket): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
        ws.once("message", (data: Buffer) => resolve(JSON.parse(data.toString("utf8"))));
    });

const subscribe = (ws: WebSocket): Promise<Record<string, unknown>> => {
    const reply = nextMessage(ws);
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: SUBSCRIBE_METHOD, id: "sub" }));
    return reply;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The server's heartbeat interval, so a tick advances exactly one beat. */
const HEARTBEAT_MS = 30_000;

describe("createServer", () => {
    test("completes the handshake and answers a request", async (t) => {
        const { nodeView, port } = await setup(t);
        nodeView.seed({ id: N1, reachable: true });
        const ws = await connect(port, TOKEN);
        after(() => ws.close());

        const reply = nextMessage(ws);
        ws.send(JSON.stringify({ jsonrpc: "2.0", method: "node.list", id: 1 }));
        const response = await reply;

        assert.equal(response.id, 1);
        assert.deepEqual(response.result, [{ id: N1, reachable: true }]);
    });

    test("rejects a mismatched schema version with HTTP 426", async (t) => {
        const { port } = await setup(t);
        await assert.rejects(connect(port, TOKEN, "999"), /426/);
    });

    test("rejects an invalid auth token with HTTP 401", async (t) => {
        const { port } = await setup(t);
        await assert.rejects(connect(port, "wrong-token"), /401/);
    });

    test("subscribe returns a snapshot of the current state", async (t) => {
        const { nodeView, port } = await setup(t);
        nodeView.seed({ id: N1, reachable: true });
        const ws = await connect(port, TOKEN);
        after(() => ws.close());

        const response = await subscribe(ws);

        assert.equal(response.id, "sub");
        const result = response.result as { nodes: unknown[]; endpoints: unknown[]; rooms: unknown[] };
        assert.deepEqual(result.nodes, [{ id: N1, reachable: true }]);
        assert.deepEqual(result.endpoints, []);
        assert.deepEqual(result.rooms, []);
    });

    test("does not forward events before subscribe", async (t) => {
        const { bus, port } = await setup(t);
        const ws = await connect(port, TOKEN);
        after(() => ws.close());

        const arrived = nextMessage(ws).then(() => "message");
        const idle = new Promise((resolve) => setTimeout(() => resolve("idle"), 100));
        bus.emit("room:added", { room: { id: R1, name: "Kitchen" }, timestamp: Date.now() });

        assert.equal(await Promise.race([arrived, idle]), "idle");
    });

    test("forwards events after subscribe", async (t) => {
        const { bus, port } = await setup(t);
        const ws = await connect(port, TOKEN);
        after(() => ws.close());
        await subscribe(ws);

        const received = nextMessage(ws);
        bus.emit("room:added", { room: { id: R1, name: "Kitchen" }, timestamp: Date.now() });
        const notification = await received;

        assert.equal(notification.method, "room:added");
        assert.deepEqual((notification.params as { room: unknown }).room, { id: R1, name: "Kitchen" });
    });

    test("re-subscribing re-delivers a fresh baseline in order, with events still flowing", async (t) => {
        const { bus, port } = await setup(t);
        const ws = await connect(port, TOKEN);
        after(() => ws.close());
        const inbox: Record<string, unknown>[] = [];
        ws.on("message", (data: Buffer) => inbox.push(JSON.parse(data.toString("utf8"))));

        ws.send(JSON.stringify({ jsonrpc: "2.0", method: SUBSCRIBE_METHOD, id: "s1" }));
        await delay(40);
        bus.emit("room:added", { room: { id: R1, name: "Kitchen" }, timestamp: Date.now() });
        await delay(40);
        ws.send(JSON.stringify({ jsonrpc: "2.0", method: SUBSCRIBE_METHOD, id: "s2" }));
        await delay(40);
        bus.emit("room:removed", { roomId: R1, timestamp: Date.now() });
        await delay(40);

        // Two fresh snapshots, each before the events that follow it — no phantom, no gap.
        assert.deepEqual(
            inbox.map((message) => message.id ?? message.method),
            ["s1", "room:added", "s2", "room:removed"],
        );
    });

    test("keeps a responsive client connected across heartbeats", async (t) => {
        // Only setInterval is mocked, so the heartbeat runs on the server's real interval while
        // the delays below stay real time — long enough for the ping and pong frames to travel.
        t.mock.timers.enable({ apis: ["setInterval"] });
        const { port } = await setup(t);
        const ws = await connect(port, TOKEN);
        after(() => ws.close());

        for (let beat = 0; beat < 3; beat++) {
            t.mock.timers.tick(HEARTBEAT_MS);
            await delay(50);
        }

        // A ws client auto-pongs every ping, so it is never reaped.
        assert.equal(ws.readyState, WebSocket.OPEN);
    });

    test("reaps a client that stops responding to pings", async (t) => {
        t.mock.timers.enable({ apis: ["setInterval"] });
        const { port } = await setup(t);
        const ws = await connect(port, TOKEN);
        after(() => ws.close());

        // Pausing suppresses the client's auto-pong: the first beat pings, the second finds no
        // pong and terminates. A paused socket is slow to notice that close, so it is resumed
        // before asserting — the reap is the server behaviour under test, not the client's
        // timing.
        const closed = new Promise<void>((resolve) => ws.on("close", () => resolve()));
        ws.pause();
        t.mock.timers.tick(HEARTBEAT_MS);
        await delay(60);
        t.mock.timers.tick(HEARTBEAT_MS);
        await delay(60);
        ws.resume();
        await Promise.race([closed, delay(200)]);

        assert.equal(ws.readyState, WebSocket.CLOSED);
    });

    test("a second start() is a no-op: it neither rejects nor duplicates event forwarding", async (t) => {
        const { bus, port, server } = await setup(t);

        // Without a guard this rejects with ERR_SERVER_ALREADY_LISTEN, after having subscribed
        // the bus a second time and stranded the first heartbeat interval.
        await server.start();

        const ws = await connect(port, TOKEN);
        after(() => ws.close());
        await subscribe(ws);

        const first = nextMessage(ws);
        bus.emit("room:added", { room: { id: R1, name: "Kitchen" }, timestamp: Date.now() });
        assert.equal((await first).method, "room:added");

        // A duplicated subscription would deliver the same event twice; the next message must be
        // the following event, not a repeat of the previous one.
        const second = nextMessage(ws);
        bus.emit("room:removed", { roomId: R1, timestamp: Date.now() });
        assert.equal((await second).method, "room:removed");
    });

    test("stop() is idempotent: stopping an already-stopped server does not reject", async (t) => {
        const { server } = await setup(t);

        await server.stop();
        // Without a guard this rejects with ERR_SERVER_NOT_RUNNING, which the composition root
        // would log as a component that failed to stop. (setup's t.after calls stop() a third
        // time, so the test also covers the teardown path.)
        await server.stop();
    });

    test("start() rejects when the port is in use, instead of never settling", async (t) => {
        const occupied = createServer();
        const port = await new Promise<number>((resolve) => {
            occupied.listen(0, "127.0.0.1", () => {
                const address = occupied.address();
                resolve(typeof address === "object" && address !== null ? address.port : 0);
            });
        });
        t.after(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
        const { server } = await setup(t, { port, start: false });

        // A failed listen never calls its callback — it emits 'error'. With nothing listening
        // for that, the promise settles neither way and the hub hangs at boot with no log.
        await assert.rejects(
            () => server.start(),
            (error: unknown) => {
                assert.equal((error as NodeJS.ErrnoException).code, "EADDRINUSE");
                return true;
            },
        );
    });

    test("a failed start leaves the provider unstarted, so a later start still works", async (t) => {
        const occupied = createServer();
        const port = await new Promise<number>((resolve) => {
            occupied.listen(0, "127.0.0.1", () => {
                const address = occupied.address();
                resolve(typeof address === "object" && address !== null ? address.port : 0);
            });
        });
        const { server } = await setup(t, { port, start: false });
        await assert.rejects(() => server.start());
        await new Promise<void>((resolve) => occupied.close(() => resolve()));

        // Without #unwind, `#heartbeat` would still be set from the failed attempt and this
        // second start() would be a silent no-op: the server would never listen at all.
        await server.start();
        const ws = await connect(port, TOKEN);
        after(() => ws.close());
        await subscribe(ws);
    });

    test("a stopped server starts again and accepts clients, so the lifecycle is reversible", async (t) => {
        const { server, port } = await setup(t);
        await server.stop();

        // A WebSocketServer cannot be reused once closed. Built in the constructor, it survived
        // stop() in its terminal state and every upgrade after a restart was aborted with HTTP
        // 503 — start() resolving all the same, so the failure was invisible until a client
        // tried to connect.
        await server.start();

        const ws = await connect(port, TOKEN);
        after(() => ws.close());
        const snapshot = await subscribe(ws);
        assert.equal(snapshot.id, "sub");
        const result = snapshot.result as { nodes: unknown[]; endpoints: unknown[]; rooms: unknown[] };
        assert.deepEqual(result.nodes, []);
    });
});
