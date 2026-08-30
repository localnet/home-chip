import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";

import { SCHEMA_VERSION } from "@home-chip/contract/common/version.ts";
import type { JsonRpcResponse } from "@home-chip/contract/server/schemas.ts";

import { AUTH_TOKEN } from "./hub.ts";

interface HandshakeOptions {
    readonly token?: string;
    /** Null omits the query parameter entirely, which is what an unversioned client sends. */
    readonly version?: number | null;
}

const query = (version: number | null): string => (version === null ? "" : `?v=${version}`);

/**
 * A client speaking the hub's handshake: the schema version in the query, the token as the sole
 * subprotocol — browsers being unable to set headers, which is why the server reads it there.
 *
 * Node's own WebSocket, so this app needs no client library of its own.
 */
export function connect(url: string, options: HandshakeOptions = {}): WebSocket {
    const { token = AUTH_TOKEN, version = SCHEMA_VERSION } = options;
    return new WebSocket(`${url}/${query(version)}`, [token]);
}

/** Resolves when the socket opens, rejecting if the server refuses the upgrade. */
export function opened(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        // The native client reports a refused upgrade as a bare error with no status, so a test
        // that cares which refusal it met asks refusedUpgrade below instead.
        ws.addEventListener("error", () => reject(new Error("upgrade refused")), { once: true });
    });
}

/**
 * The HTTP status the server answers a handshake with, by making the upgrade request by hand.
 * Node's WebSocket surfaces a refusal as an error carrying neither the code nor a message, and
 * 401 against 426 is exactly the distinction the hub draws — a bad token against a schema version
 * it cannot serve — so the status is read from the response itself.
 */
export function refusedUpgrade(url: string, options: HandshakeOptions = {}): Promise<number> {
    const { token = AUTH_TOKEN, version = SCHEMA_VERSION } = options;
    const { hostname, port } = new URL(url);

    return new Promise((resolve, reject) => {
        const upgrade = httpRequest({
            hostname,
            port,
            path: `/${query(version)}`,
            headers: {
                Connection: "Upgrade",
                Upgrade: "websocket",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
                "Sec-WebSocket-Protocol": token,
            },
        });
        // A refusal answers as an ordinary response; an accepted handshake emits 'upgrade', which
        // is a failure here since the caller asked for the refusal.
        upgrade.once("response", (response) => resolve(response.statusCode ?? 0));
        upgrade.once("upgrade", (_response, socket) => {
            socket.destroy();
            reject(new Error("the handshake was accepted"));
        });
        upgrade.once("error", reject);
        upgrade.end();
    });
}

/** Sends a request and resolves with the response carrying its id, ignoring notifications. */
export function request(ws: WebSocket, method: string, params?: unknown, id = "1"): Promise<JsonRpcResponse> {
    return new Promise((resolve) => {
        const onMessage = (event: MessageEvent): void => {
            const message = JSON.parse(String(event.data)) as JsonRpcResponse & { id?: unknown };
            if (message.id !== id) {
                return;
            }
            ws.removeEventListener("message", onMessage);
            resolve(message);
        };
        ws.addEventListener("message", onMessage);
        ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    });
}

/** A server-pushed notification: a message carrying a method and no id. */
export interface Notification {
    readonly method: string;
    readonly params: unknown;
}

/**
 * Collects every notification the server pushes from the moment it is called, and hands back a
 * way to wait for one by name.
 *
 * Waiting for "the next notification" and asserting what it was would tie a test to an ordering
 * nothing promises: a node coming online can announce itself before or after it is recorded, and
 * either order is correct. Matching by name also means a test may await one that has already
 * arrived, which is otherwise a race it would lose intermittently.
 */
export function collectNotifications(ws: WebSocket): (method: string, timeoutMs?: number) => Promise<Notification> {
    const received: Notification[] = [];
    const waiting = new Map<string, (notification: Notification) => void>();

    ws.addEventListener("message", (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as { method?: string; params?: unknown };
        if (message.method === undefined) {
            return;
        }
        const notification = { method: message.method, params: message.params };
        received.push(notification);
        waiting.get(notification.method)?.(notification);
    });

    return (method, timeoutMs = 5_000) => {
        const already = received.find((notification) => notification.method === method);
        if (already !== undefined) {
            return Promise.resolve(already);
        }
        return new Promise((resolve, reject) => {
            const timer = globalThis.setTimeout(
                () => reject(new Error(`${method} never arrived. Received: ${received.map((n) => n.method)}`)),
                timeoutMs,
            );
            waiting.set(method, (notification) => {
                globalThis.clearTimeout(timer);
                resolve(notification);
            });
        });
    };
}
