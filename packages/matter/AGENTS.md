# @home-chip/matter

Encapsulates all interaction with the Matter protocol.

## Responsibilities

- Wrapper over `@matter/main` (Commissioning / Controller)
- Device commissioning (no BLE — network-based only)
- Device discovery via mDNS
- Cluster subscriptions and commands
- Matter SDK logging and environment configuration

## Dependencies

Direct: `@home-chip/contract`, `@home-chip/system`, `@matter/main`

## Boundaries

This is the **only** package that imports `@matter/main`. All Matter protocol concerns are encapsulated here. Other packages interact with Matter exclusively through interfaces defined in `@home-chip/contract`. The concrete classes in this package implement those interfaces.

matter.js manages its own persistence (`matter.db`). This package configures the storage path via `MATTER_STORAGE_PATH` but does not interfere with its contents.

## Logging Integration

`@matter/main` uses a static singleton `Logger` with a `destinations` map. This package integrates it with the unified log system by connecting `@home-chip/system`'s log sink to a custom destination:

```ts
import { Logger } from "@matter/main";
import { createLogSink } from "@home-chip/system";

Logger.destinations.default = {
    write: createLogSink("matter"),
};
```

This configuration **must happen before instantiating any Matter component**. `NodeJsEnvironment` initializes on first component instantiation and would otherwise overwrite the destination configuration.

## Environment Variables

This package is responsible for configuring all `MATTER_*` variables before initializing the SDK:

- `MATTER_LOG_LEVEL` — mapped from application settings; valid values: `fatal`, `error`, `warn`, `notice`, `info`, `debug`
- `MATTER_LOG_FORMAT` — mapped from application settings
- `MATTER_STORAGE_PATH` — set from the resolved `HOMECHIP_STORAGE_PATH` provided by `@home-chip/system`
- `MATTER_MDNS_NETWORKINTERFACE` — set from application settings if configured

`HOMECHIP_*` variables are not read directly here — their resolved values are received by constructor injection from `@home-chip/system`.

## Initialization Order

1. Receive resolved paths and settings from `@home-chip/system` via constructor injection
2. Configure `Logger.destinations` (logging must be set up first)
3. Set `MATTER_*` environment variables
4. Instantiate Matter components

## What Does NOT Belong Here

- Home metadata (names, icons, zones — belongs in `registry`)
- Generic data persistence (belongs in `database`)
- API transport (belongs in `server`)
- Reading or resolving `HOMECHIP_*` environment variables (belongs in `system`)
