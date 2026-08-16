/**
 * Returned by `on()` to remove the subscription. Calling it twice is a no-op.
 */
export type Unsubscribe = () => void;

/**
 * In-process pub/sub bus for cross-package coordination, generic over the event map it
 * carries so that `common` stays the dependency-free base: the concrete HomeChip map is
 * bound to it in `contract/events.ts` as `DomainEventBus`, the alias consumers depend on.
 * Implementations live in the registry package.
 *
 * Design constraints:
 *   - Synchronous dispatch: handlers run inline during `emit()`. A handler that throws must
 *     neither stop the remaining handlers nor propagate the error to the emitter;
 *     implementations log it and continue.
 *   - No replay: subscribers added after an `emit()` do not see past events. State hydration
 *     uses the registry's snapshot methods, not the bus.
 *   - No backpressure: this is a memory-only bus, not a queue. Persist before emitting when
 *     you need durability.
 */
export interface EventBus<TEventMap> {
    emit<K extends keyof TEventMap>(eventName: K, payload: TEventMap[K]): void;
    on<K extends keyof TEventMap>(eventName: K, handler: (payload: TEventMap[K]) => void): Unsubscribe;
}
