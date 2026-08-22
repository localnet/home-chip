import type { EventBus, Unsubscribe } from "@home-chip/contract/common/bus.ts";
import type { DomainEventMap } from "@home-chip/contract/events.ts";

type EventName = keyof DomainEventMap;
type Handler<K extends EventName> = (payload: DomainEventMap[K]) => void;

/**
 * Minimal EventBus for tests: records emitted events so assertions can inspect them,
 * and supports on/emit. Not the production bus (that lives in @home-chip/registry).
 */
export class TestEventBus implements EventBus<DomainEventMap> {
    readonly emitted: { name: EventName; payload: unknown }[] = [];
    readonly #handlers = new Map<EventName, Set<Handler<EventName>>>();

    emit<K extends EventName>(eventName: K, payload: DomainEventMap[K]): void {
        this.emitted.push({ name: eventName, payload });
        for (const handler of this.#handlers.get(eventName) ?? []) {
            (handler as Handler<K>)(payload);
        }
    }

    on<K extends EventName>(eventName: K, handler: Handler<K>): Unsubscribe {
        let handlers = this.#handlers.get(eventName);
        if (handlers === undefined) {
            handlers = new Set();
            this.#handlers.set(eventName, handlers);
        }
        handlers.add(handler as Handler<EventName>);
        return () => {
            handlers.delete(handler as Handler<EventName>);
        };
    }
}
