import type { EventBus, Unsubscribe } from "@home-chip/contract/common/bus.ts";
import type { DomainEventBus, DomainEventMap } from "@home-chip/contract/events.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";

type EventName = keyof DomainEventMap;
type Handler<K extends EventName> = (payload: DomainEventMap[K]) => void;

/**
 * The EventBus contract over in-process synchronous dispatch: handlers run inline during `emit()`,
 * one that throws is logged without stopping the rest or reaching the emitter, and there is
 * neither replay nor backpressure.
 *
 * Handlers are kept per event name, so `emit()` visits only the handlers of the event it carries
 * rather than scanning every subscription.
 */
class SyncEventBus implements EventBus<DomainEventMap> {
    readonly #logger: Logger;
    readonly #handlers = new Map<EventName, Set<Handler<EventName>>>();

    constructor(logger: Logger) {
        this.#logger = logger.get("EventBus");
    }

    emit<K extends EventName>(eventName: K, payload: DomainEventMap[K]): void {
        const handlers = this.#handlers.get(eventName);
        if (handlers === undefined) {
            return;
        }
        // A copy, so that a handler subscribing another mid-dispatch does not have it run for
        // the event in flight: a Set iterator visits an element added while it runs. The change
        // takes effect on the next emit(). Unsubscribing needs no copy — a Set iterator handles a
        // deletion on its own — but the copy covers both without a second rule.
        for (const handler of [...handlers]) {
            try {
                (handler as Handler<K>)(payload);
            } catch (error) {
                this.#logger.error("event handler failed", eventName, error);
            }
        }
    }

    on<K extends EventName>(eventName: K, handler: Handler<K>): Unsubscribe {
        let handlers = this.#handlers.get(eventName);
        if (handlers === undefined) {
            handlers = new Set();
            this.#handlers.set(eventName, handlers);
        }
        handlers.add(handler as Handler<EventName>);

        // The flag makes the returned function belong to this subscription rather than to the
        // handler. Without it, a caller that unsubscribes, subscribes the same function again and
        // then calls the first unsubscribe once more would tear down the second subscription.
        let subscribed = true;
        return () => {
            if (!subscribed) {
                return;
            }
            subscribed = false;
            const current = this.#handlers.get(eventName);
            if (current === undefined) {
                return;
            }
            current.delete(handler as Handler<EventName>);
            if (current.size === 0) {
                this.#handlers.delete(eventName);
            }
        };
    }
}

export function createEventBus(logger: Logger): DomainEventBus {
    return new SyncEventBus(logger);
}
