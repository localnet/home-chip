import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

import { UnauthorizedError } from "@home-chip/contract/common/errors.ts";
import type { Lifecycle } from "@home-chip/contract/common/lifecycle.ts";
import { isCompatibleSchema } from "@home-chip/contract/common/version.ts";
import type { ServerConfig } from "@home-chip/contract/config/schemas.ts";
import type { EndpointView } from "@home-chip/contract/endpoint/ports.ts";
import { DOMAIN_EVENT_NAMES, type DomainEventBus } from "@home-chip/contract/events.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import type { NodeView } from "@home-chip/contract/node/ports.ts";
import type { RoomView } from "@home-chip/contract/room/ports.ts";
import { SchemaVersionMismatchError } from "@home-chip/contract/server/errors.ts";
import { SUBSCRIBE_METHOD } from "@home-chip/contract/snapshot.ts";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import { JsonRpcChannel } from "./channel.ts";
import { JsonRpcDispatcher } from "./dispatcher.ts";
import { endpointHandlers } from "./handlers/endpoint.ts";
import { nodeHandlers } from "./handlers/node.ts";
import { roomHandlers } from "./handlers/room.ts";
import type { CommissionUseCase } from "./use-cases/commission.ts";
import type { DecommissionUseCase } from "./use-cases/decommission.ts";
import type { EndpointUseCase } from "./use-cases/endpoint.ts";
import type { NodeUseCase } from "./use-cases/node.ts";
import type { RoomUseCase } from "./use-cases/room.ts";
import { parseClientMessage } from "./wire.ts";

/** Collaborators: logging, the event bus, the read model (views) and the write operations (use-cases). */
export interface ServerDeps {
    readonly logger: Logger;
    readonly bus: DomainEventBus;
    readonly nodeView: NodeView;
    readonly endpointView: EndpointView;
    readonly roomView: RoomView;
    readonly commissionUseCase: CommissionUseCase;
    readonly decommissionUseCase: DecommissionUseCase;
    readonly nodeUseCase: NodeUseCase;
    readonly endpointUseCase: EndpointUseCase;
    readonly roomUseCase: RoomUseCase;
}

/**
 * The server section of the config, plus the secret that never appears in a file. Intersected
 * rather than restated so a field added to the section reaches here, as matter does with its own.
 */
export type ServerOptions = ServerConfig & { readonly authToken: string };

const HEARTBEAT_MS = 30_000;

function toText(data: RawData): string {
    if (Array.isArray(data)) {
        return Buffer.concat(data).toString("utf8");
    }
    if (Buffer.isBuffer(data)) {
        return data.toString("utf8");
    }
    return Buffer.from(data).toString("utf8");
}

/**
 * The WebSocket transport: one JSON-RPC endpoint over ws, on an explicit http.Server so a
 * future static-file handler can share the same port. It owns the connection lifecycle — the
 * upgrade handshake (schema version via the `v` query param, auth via the WebSocket
 * subprotocol), per-message parsing and routing, and a heartbeat that reaps dead connections —
 * and delegates the event stream (who is subscribed, the snapshot they get, forwarding events
 * to them) to {@link JsonRpcChannel}. All protocol and domain logic lives in the dispatcher it
 * builds from the handler groups.
 *
 * Open connections are not tracked here: the WebSocket server tracks them (`#wss.clients`),
 * which is all that stop() needs. This holds only the subscriber subset, inside JsonRpcChannel.
 */
class HttpServerProvider implements Lifecycle {
    readonly #logger: Logger;
    readonly #bus: DomainEventBus;
    readonly #host: string;
    readonly #port: number;
    readonly #authToken: string;
    readonly #channel: JsonRpcChannel;
    readonly #dispatcher: JsonRpcDispatcher;
    readonly #unsubscribes: (() => void)[] = [];
    readonly #alive = new WeakMap<WebSocket, boolean>();
    #server: Server | undefined;
    #wss: WebSocketServer | undefined;
    #heartbeat: NodeJS.Timeout | undefined;

    constructor(deps: ServerDeps, options: ServerOptions) {
        this.#logger = deps.logger.get("Server");
        this.#bus = deps.bus;
        this.#host = options.host;
        this.#port = options.port;
        this.#authToken = options.authToken;
        this.#channel = new JsonRpcChannel({
            nodeView: deps.nodeView,
            endpointView: deps.endpointView,
            roomView: deps.roomView,
        });
        this.#dispatcher = new JsonRpcDispatcher(this.#logger, {
            ...nodeHandlers({
                nodeView: deps.nodeView,
                commissionUseCase: deps.commissionUseCase,
                decommissionUseCase: deps.decommissionUseCase,
                nodeUseCase: deps.nodeUseCase,
            }),
            ...endpointHandlers({
                endpointView: deps.endpointView,
                endpointUseCase: deps.endpointUseCase,
            }),
            ...roomHandlers({ roomView: deps.roomView, roomUseCase: deps.roomUseCase }),
        });
    }

    async start(): Promise<void> {
        if (this.#server !== undefined || this.#wss !== undefined) {
            return;
        }
        const server = createServer();
        const wss = new WebSocketServer({
            noServer: true,
            // The token is the only subprotocol offered, echoed back so the handshake is valid:
            // a browser fails if the server selects one it did not offer. It is already verified
            // by the time this runs.
            handleProtocols: (protocols) => (protocols.has(this.#authToken) ? this.#authToken : false),
        });

        // The socket comes first, so a failed listen — EADDRINUSE above all — leaves nothing
        // behind: no heartbeat running, no bus subscription forwarding events, no fields set.
        // The rejection is what makes that work: listen() never calls back on failure, it emits
        // 'error', so without it the promise would never settle and the hub would hang at boot
        // with nothing to report.
        await new Promise<void>((resolve, reject) => {
            server.once("listening", () => resolve());
            server.once("error", (error) => reject(error));
            server.listen(this.#port, this.#host);
        });

        // Everything from here is committed only once the socket is up. Both resources reach
        // their callbacks by closure rather than off the fields: they only run while started, so
        // reading a field would need a guard that could never fire.
        server.on("upgrade", (request, socket, head) => this.#handleUpgrade(wss, request, socket, head));
        server.on("error", (error) => this.#logger.error("socket error", error));

        this.#heartbeat = setInterval(() => this.#pulse(wss), HEARTBEAT_MS);
        for (const eventName of DOMAIN_EVENT_NAMES) {
            this.#unsubscribes.push(this.#bus.on(eventName, (payload) => this.#channel.forward(eventName, payload)));
        }

        this.#server = server;
        this.#wss = wss;
    }

    async stop(): Promise<void> {
        if (this.#server === undefined || this.#wss === undefined) {
            return;
        }
        const server = this.#server;
        const wss = this.#wss;

        // Stop producing before closing: the heartbeat would otherwise ping sockets that are on
        // their way out, and a domain event emitted while the sockets close would be forwarded to
        // connections nobody is listening on any more.
        clearInterval(this.#heartbeat);
        this.#heartbeat = undefined;
        for (const unsubscribe of this.#unsubscribes) {
            unsubscribe();
        }
        this.#unsubscribes.length = 0;

        for (const ws of wss.clients) {
            ws.close();
        }
        await new Promise<void>((resolve, reject) => {
            wss.close((error) => (error ? reject(error) : resolve()));
        });
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
        this.#server = undefined;
        this.#wss = undefined;
    }

    #handleUpgrade(wss: WebSocketServer, request: IncomingMessage, socket: Duplex, head: Buffer): void {
        try {
            this.#authenticate(request);
        } catch (error) {
            this.#rejectUpgrade(socket, error);
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => this.#onConnection(ws));
    }

    #authenticate(request: IncomingMessage): void {
        const url = new URL(request.url ?? "/", "http://localhost");
        const version = url.searchParams.get("v");
        // Absent or non-numeric `v` becomes null, which the contract's check treats as one more
        // incompatible client, so the whole policy stays there.
        const received = version !== null && /^\d+$/.test(version) ? Number(version) : null;
        if (!isCompatibleSchema(received)) {
            throw new SchemaVersionMismatchError(received);
        }
        if (!this.#offeredProtocols(request).includes(this.#authToken)) {
            throw new UnauthorizedError("Missing or invalid auth token");
        }
    }

    #offeredProtocols(request: IncomingMessage): string[] {
        const header = request.headers["sec-websocket-protocol"];
        if (header === undefined) {
            return [];
        }
        return header
            .split(",")
            .map((protocol) => protocol.trim())
            .filter((protocol) => protocol.length > 0);
    }

    #rejectUpgrade(socket: Duplex, error: unknown): void {
        const { status, reason } =
            error instanceof SchemaVersionMismatchError
                ? { status: 426, reason: "Upgrade Required" }
                : { status: 401, reason: "Unauthorized" };
        this.#logger.notice("rejected upgrade", status, error instanceof Error ? error.message : error);
        socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
    }

    #onConnection(ws: WebSocket): void {
        this.#alive.set(ws, true);
        ws.on("pong", () => this.#alive.set(ws, true));
        ws.on("message", (data) => void this.#onMessage(ws, data));
        ws.on("close", () => this.#channel.remove(ws));
        ws.on("error", (error) => this.#logger.warn("client socket error", error));
    }

    async #onMessage(ws: WebSocket, data: RawData): Promise<void> {
        const outcome = parseClientMessage(toText(data));
        // Handled here and not in the dispatcher, which awaits its handlers: the snapshot and
        // the client going live must not be separated by a yield. Everything else goes to the
        // dispatcher, already parsed, so nothing is parsed twice.
        if ("request" in outcome && outcome.request.method === SUBSCRIBE_METHOD) {
            this.#channel.subscribe(ws, outcome.request.id);
            return;
        }
        const response = await this.#dispatcher.route(outcome);
        if (response !== null) {
            ws.send(JSON.stringify(response));
        }
    }

    #pulse(wss: WebSocketServer): void {
        for (const ws of wss.clients) {
            // Still marked not-alive means it never ponged since the last ping, so it is gone;
            // its 'close' event runs the usual cleanup. The check is `=== false` rather than
            // `!alive` so a socket not yet in the map is pinged, not reaped.
            if (this.#alive.get(ws) === false) {
                ws.terminate();
                continue;
            }
            this.#alive.set(ws, false);
            ws.ping();
        }
    }
}

export function createServerProvider(deps: ServerDeps, options: ServerOptions): Lifecycle {
    return new HttpServerProvider(deps, options);
}
