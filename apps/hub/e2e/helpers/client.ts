import { ValidationError } from "@home-chip/contract/common/errors.ts";
import { SCHEMA_VERSION } from "@home-chip/contract/common/version.ts";
import {
    type JsonRpcNotification,
    type JsonRpcResponse,
    validateServerMessage,
} from "@home-chip/contract/server/schemas.ts";

import { AUTH_TOKEN } from "./hub.ts";

/**
 * A client speaking the hub's handshake: the schema version in the query, the token as the sole
 * subprotocol — browsers being unable to set headers, which is why the server reads it there.
 *
 * Node's own WebSocket, so this app needs no client library of its own.
 */
export function connect(url: string): WebSocket {
    return new WebSocket(`${url}/?v=${SCHEMA_VERSION}`, [AUTH_TOKEN]);
}

/** Resolves when the socket opens, rejecting if the server refuses the upgrade. */
export function opened(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        // The native client reports a refused upgrade as a bare error with no status, so this can
        // say no more than that. Which refusal, and why, is the server package's to test.
        ws.addEventListener("error", () => reject(new Error("upgrade refused")), { once: true });
    });
}

/**
 * Long enough for the slowest operation the hub serves — a commissioning, which discovers the
 * device, runs PASE and reads its whole structure, and takes upwards of a second on a loaded
 * runner. Short enough that a request nobody is going to answer fails as one, naming itself:
 * node --test has no timeout of its own, so it would otherwise hold the run until CI kills the
 * job, with nothing said about which request.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** Sends a request and resolves with the response carrying its id, ignoring notifications. */
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Reads a frame the way a client has to: through the contract's own validator, which is exported
 * for consumers and which nothing in this repository otherwise calls. Casting instead would let a
 * frame that does not answer the contract — a missing `jsonrpc`, an error without a code, a result
 * where the schema wants none — travel into a test and fail it somewhere else, or pass.
 *
 * A refusal is rendered with the issues the validator collected, each with its path: the error's
 * own message is "Invalid params" whatever was wrong with the frame.
 */
function frame(event: MessageEvent): JsonRpcResponse | JsonRpcNotification {
    const raw = String(event.data);
    try {
        return validateServerMessage(JSON.parse(raw));
    } catch (error) {
        const issues = error instanceof ValidationError ? JSON.stringify(error.data) : String(error);
        throw new Error(`${issues} for ${raw}`);
    }
}

function request(ws: WebSocket, method: string, params?: unknown, id = "1"): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
            ws.removeEventListener("message", onMessage);
            reject(new Error(`${method} (id ${id}) went unanswered for ${REQUEST_TIMEOUT_MS}ms`));
        }, REQUEST_TIMEOUT_MS);

        const onMessage = (event: MessageEvent): void => {
            let message: JsonRpcResponse | JsonRpcNotification;
            try {
                message = frame(event);
            } catch (error) {
                // Reported against the request in flight rather than thrown out of a listener,
                // where it would arrive with no idea which call it answers.
                globalThis.clearTimeout(timer);
                ws.removeEventListener("message", onMessage);
                reject(new Error(`${method} (id ${id}) met a frame the contract refuses: ${errorMessage(error)}`));
                return;
            }
            if (!("id" in message) || message.id !== id) {
                return;
            }
            globalThis.clearTimeout(timer);
            ws.removeEventListener("message", onMessage);
            resolve(message);
        };
        ws.addEventListener("message", onMessage);
        ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    });
}

/**
 * Sends a request that is expected to succeed and resolves with its result. An error response
 * throws with the error as the hub sent it — code, message and `data`, which is where the domain
 * code and the offending ids travel — because a test that only asserts "result" is present fails
 * with "the expression evaluated to a falsy value" and nothing about what the hub answered.
 */
export async function call(ws: WebSocket, method: string, params?: unknown, id = "1"): Promise<unknown> {
    const response = await request(ws, method, params, id);
    if ("error" in response) {
        throw new Error(`${method} (id ${id}) answered with an error: ${JSON.stringify(response.error)}`);
    }
    return response.result;
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

    // A frame the contract refuses is kept rather than thrown here, and reported by whoever waits:
    // a throw inside a listener belongs to no test in particular.
    let refused: Error | undefined;

    ws.addEventListener("message", (event: MessageEvent) => {
        let message: JsonRpcResponse | JsonRpcNotification;
        try {
            message = frame(event);
        } catch (error) {
            refused ??= new Error(`the hub pushed a frame the contract refuses: ${errorMessage(error)}`);
            return;
        }
        if (!("method" in message)) {
            return;
        }
        const notification = { method: message.method, params: message.params };
        received.push(notification);
        waiting.get(notification.method)?.(notification);
    });

    return (method, timeoutMs = 5_000) => {
        if (refused !== undefined) {
            return Promise.reject(refused);
        }
        const already = received.find((notification) => notification.method === method);
        if (already !== undefined) {
            return Promise.resolve(already);
        }
        return new Promise((resolve, reject) => {
            // Refused rather than replacing the waiter already there, which the map holds one of
            // per name: the first would be stranded, and the check above would hand both the same
            // arrival anyway. Two of a kind needs a waiter that queues them.
            if (waiting.has(method)) {
                reject(new Error(`${method} is already being waited for; this helper takes one waiter per method`));
                return;
            }
            const timer = globalThis.setTimeout(
                () =>
                    reject(refused ?? new Error(`${method} never arrived. Received: ${received.map((n) => n.method)}`)),
                timeoutMs,
            );
            waiting.set(method, (notification) => {
                globalThis.clearTimeout(timer);
                resolve(notification);
            });
        });
    };
}
