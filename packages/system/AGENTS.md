# @home-chip/system

Infrastructure: paths, configuration, and logging.

## Responsibilities

- Path resolution from environment variables (`HOMECHIP_CONFIG_FILE`, `HOMECHIP_STORAGE_PATH`, `HOMECHIP_LOG_PATH`)
- Reading and validating `config.json` (using Valibot schemas from `@home-chip/contract`)
- Safe default values for all configuration
- Log sink creation with rotation via `rotating-file-stream`
- First-run detection and initialization

## Dependencies

Direct: `@home-chip/contract`, `rotating-file-stream`

## Boundaries

`system` provides infrastructure services consumed by most other packages. It has no knowledge of `@matter/main` or any domain package. It does NOT resolve Matter-specific environment variables (`MATTER_*`) — that is the responsibility of `@home-chip/matter`.

## Logging Architecture

`system` manages two independent rotating log files: `home.log` for application logs (all packages except Matter) and `matter.log` for Matter SDK internal logs.

The public API is:

```ts
createLogSink(stream: "home" | "matter"): (text: string) => void
```

This returns a plain callback. Callers receive a function to write pre-formatted text — they do not interact with the underlying stream directly. This keeps consumers decoupled from `rotating-file-stream`.

`@home-chip/matter` calls `createLogSink("matter")` and connects the returned callback to `Logger.destinations` from `@matter/main`. `system` has no knowledge of this integration.

Error handling: stream errors (disk full, permission denied) must be handled externally by the caller. The callback itself does not throw.

## Environment Variables

`system` resolves only `HOMECHIP_*` variables:

- `HOMECHIP_CONFIG_FILE` — path to `config.json`
- `HOMECHIP_STORAGE_PATH` — base path for persistent storage (used by database and passed to matter)
- `HOMECHIP_LOG_PATH` — base path for log files

`MATTER_*` variables are not read or set by this package.

## What Does NOT Belong Here

- Business logic
- Database access
- Matter protocol interaction
- API transport
- Resolving or forwarding `MATTER_*` environment variables
