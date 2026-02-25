# @home-chip/core

Central coordinator and in-memory state.

## Responsibilities

- Event bus for inter-component communication
- Current device state (in-memory only, not persisted here)
- Translation between `DeviceId` and `NodeId`
- Command delegation to `matter`
- Orchestration of multi-step flows (e.g., reconciliation confirmation)
- Unified API surface for `server`

## Dependencies

Direct: `@home-chip/contract`, `@home-chip/system`
Injected: `@home-chip/matter`, `@home-chip/registry`

`core` receives `matter` and `registry` implementations through constructor injection. It depends on their interfaces defined in `@home-chip/contract`, never on the concrete packages directly.

## Boundaries

`core` is the **coordinator**, not the composition root. It does not instantiate its dependencies — `@home-chip/hub` handles wiring. `core` does not access the database, the file system, or the network directly. It delegates to injected services.

## Event Bus

The event bus carries domain events in one direction: from infrastructure (`matter`, `registry`) toward `server`. It is not a general-purpose bidirectional message broker. `server` subscribes to events to push updates to clients; it does not publish events back through the bus.

## DeviceId / NodeId Translation

`core` maintains an in-memory map between HomeChip's stable `DeviceId` and the Matter-assigned `NodeId`. This map is the authoritative source for translating commands from `server` (which speaks `DeviceId`) into Matter operations (which require `NodeId`). It is populated at startup and kept current as devices are commissioned or removed.

## Reconciliation Orchestration

When `registry` detects a commissioning candidate with status `disconnected`, it cannot resolve the conflict on its own — user confirmation is required. `core` orchestrates this flow:

1. `registry` returns a pending reconciliation result instead of completing the operation.
2. `core` emits a reconciliation event toward `server`, which presents the confirmation prompt to the user.
3. The user's response arrives as a command to `core`.
4. `core` calls `registry` to either confirm (preserve existing `DeviceId`, update `NodeId`) or reject (create a new `DeviceId`).

No reconciliation state is persisted between steps — `core` holds it in memory for the duration of the interaction.

## What Does NOT Belong Here

- Database access (belongs in `database`)
- Matter protocol details (belongs in `matter`)
- HTTP/WebSocket handling (belongs in `server`)
- Metadata persistence logic (belongs in `registry`)
