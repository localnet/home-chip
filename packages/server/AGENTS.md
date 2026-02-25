# @home-chip/server

HTTP and SSE API based on tRPC and Hono.

## Responsibilities

- tRPC router definitions (queries, mutations, subscriptions)
- Input validation at the API boundary (using Valibot schemas from `@home-chip/contract`)
- HTTP transport for queries and mutations via Hono
- SSE transport for device event subscriptions via tRPC subscriptions
- Static file serving (future: frontend assets)

## Dependencies

Direct: `@home-chip/contract`, `@home-chip/system`, `@trpc/server`, `hono`, `@hono/node-server`, `@hono/trpc-server`
Injected: `@home-chip/core`

`server` receives the `core` implementation through constructor injection. It depends on the interfaces defined in `@home-chip/contract`, never on `@home-chip/core` directly.

## Boundaries

`server` is pure **transport infrastructure**. It validates incoming data, delegates to `core`, and serializes responses. It contains no business logic.

Hono acts as the HTTP server. The tRPC router is mounted on `/api` via `@hono/trpc-server`. This architecture allows the same server instance to handle both the API and static file serving without running multiple servers or managing ports independently.

This is the **only** validation boundary. Data validated here is trusted by all internal packages downstream.

## What Does NOT Belong Here

- Business logic or state management (belongs in `core`)
- Direct database access (belongs in `database`)
- Direct Matter protocol calls (belongs in `matter`)
