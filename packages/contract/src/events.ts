import type { EventBus } from "./common/bus.ts";
import type { EndpointEvents } from "./endpoint/events.ts";
import type { NodeEvents } from "./node/events.ts";
import type { RoomEvents } from "./room/events.ts";

/**
 * Every domain event HomeChip has, composed from the per-subdomain interfaces. This is the one
 * place that knows the whole set: adding a subdomain means one more member in this intersection,
 * and every consumer picks its events up with no import of its own and no partially populated map.
 *
 * "Domain" separates these from the Matter SDK's own events, which speak in SDK identifiers — a
 * bigint node id, an integer endpoint number — and never reach the bus. The matter adapter
 * translates them into these first.
 *
 * The outcome of a request is not an event. It returns as the JSON-RPC response to the connection
 * that asked, and only the facts it produced along the way — `node:added`, `endpoint:added` — are
 * broadcast here for every other connection to react to.
 */
export type DomainEventMap = EndpointEvents & NodeEvents & RoomEvents;

/**
 * The bus type consumers depend on. Emitters and subscribers alike type their dependency as this,
 * never as an `EventBus<...>` assembled by hand, so none of them can bind a map of its own.
 */
export type DomainEventBus = EventBus<DomainEventMap>;

/**
 * The same set at runtime, for the server, which forwards each event to its clients and therefore
 * has to enumerate them.
 *
 * The `satisfies` is what keeps the two in step: leaving an event out, or misspelling one, is a
 * compile error, so the list cannot fall behind the map it mirrors. The `true` values carry no
 * meaning of their own — only the keys are read — which is why the literal has no name.
 */
export const DOMAIN_EVENT_NAMES = Object.keys({
    "node:added": true,
    "node:connected": true,
    "node:disconnected": true,
    "node:removed": true,
    "endpoint:added": true,
    "endpoint:changed": true,
    "endpoint:removed": true,
    "endpoint:renamed": true,
    "endpoint:room-changed": true,
    "room:added": true,
    "room:renamed": true,
    "room:removed": true,
} satisfies Record<keyof DomainEventMap, true>) as (keyof DomainEventMap)[];
