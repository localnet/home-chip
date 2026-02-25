# HomeChip

Smart Home Hub, local-first, built exclusively on the Matter protocol.

## Stack

- Runtime: Node.js 24+
- Language: TypeScript 5.9+ (strict mode, `erasableSyntaxOnly`)
- Linting/Formatting: Biome.js 2.3+
- Monorepo: NPM Workspaces
- Matter SDK: `@matter/main` (only in `packages/matter/`)
- Testing: Node.js Test Runner (`node:test`, `node:assert`)
- Database: SQLite via `node:sqlite` (only in `packages/database/`)
- Validation: Valibot (schemas defined in `packages/contract/`)
- API: tRPC + Hono + SSE (only in `packages/server/`)
- Logging: `rotating-file-stream` (only in `packages/system/`)

## Monorepo Structure

```
bin/
  home-chip.js  # CLI/service entry point — plain JS wrapper, not TypeScript
apps/
  hub/          # Composition Root — instantiates and wires all packages
packages/
  contract/     # Shared: types, interfaces, errors, Valibot schemas
  core/         # Application: event bus, in-memory state, command delegation
  database/     # Infrastructure: SQLite data access via node:sqlite
  matter/       # Infrastructure: interaction with the Matter protocol
  registry/     # Domain: home metadata that Matter does not provide
  server/       # Infrastructure: HTTP and WebSocket API based on tRPC
  system/       # Infrastructure: paths, configuration, and logging
```

Each package has a single, bounded responsibility. If unsure where code belongs, check the package `CLAUDE.md` or ask.

## Dependency Graph

```
contract  ← (every package depends on contract)
system    ← contract
database  ← contract, system
matter    ← contract, system, @matter/main
registry  ← contract, database, system
core      ← contract, system  (+ matter, registry injected at runtime)
server    ← contract, system  (+ core injected at runtime)
hub       ← all packages except contract (composition root only)
```

Injected dependencies are received through constructors, never imported directly inside a module. `core` depends on interfaces from `contract`, not on `matter` or `registry`. `server` depends on interfaces from `contract`, not on `core` directly. `hub` is the only place where concrete implementations are wired together.

External dependencies are isolated: `@matter/main` only in `packages/matter/`, `node:sqlite` only in `packages/database/`, tRPC and Hono only in `packages/server/`, Valibot only in `packages/contract/`, `rotating-file-stream` only in `packages/system/`.

## Commands

```bash
# Lint and format (auto-fix; errors must be resolved before committing)
npm run check

# Type-check all packages
npm run --workspaces type

# Type-check a single package
npm run --workspace=@home-chip/<pkg> type

# Run all tests
npm run --workspaces test

# Run tests for a single package
npm run --workspace=@home-chip/<pkg> test

# Start the hub
npm run --workspace=@home-chip/hub start
```

## Git Workflow

Branch naming follows the same types as commit messages:

```
feat/short-description
fix/short-description
refactor/short-description
test/short-description
chore/short-description
docs/short-description
```

Commit messages follow Conventional Commits:

```
feat(registry): add device metadata schema
fix(system): correct config path resolution on Linux
chore(deps): update @matter/main to 1.4.0
```

The scope is the package name without the `@home-chip/` prefix. Omit the scope only for changes that span multiple packages.

Branch protection is enabled on `main`. All changes go through a pull request. Delete the branch after the PR is merged.

## Versioning

The project follows SemVer. All packages in the monorepo share a single version number —
when the version changes, it changes in every `package.json` simultaneously.

- **Patch**: backwards-compatible bug fixes
- **Minor**: new functionality, backwards-compatible
- **Major**: breaking changes

## Validation Strategy

- Source of truth: Valibot schemas in `@home-chip/contract`
- Input validation: only at the boundary (`@home-chip/server`)
- Internal data: trusted, no re-validation between packages
- Settings: validated once on load (`@home-chip/system`)

## TypeScript Rules

Always:
- Use `.ts` extension in all local imports: `import { Foo } from "./foo.ts";`
- Use union types for enumerations: `type Status = "active" | "inactive";`
- Use runtime-private fields: `class Foo { #field: string; }`
- Use `async/await` for asynchronous code
- Keep `strict: true` — no exceptions

Never:
- `enum`, `namespace`, or the `public`/`private` keyword
- `export default` — use named exports only
- Import without `.ts` extension in local paths
- Use `any` without an explicit justification in a comment

## Naming

- Classes and interfaces: `PascalCase` (e.g., `DeviceRegistry`, `MatterController`)
- Interfaces do NOT use the `I` prefix
- Variables, properties, functions, methods: `camelCase`
- Files: `kebab-case.ts`
- Names must be descriptive and unambiguous — avoid abbreviations
- Prefer short names that avoid collisions over long names that are redundant

## Testing

Unit tests live alongside source code. Integration tests live in a separate directory.

```
packages/<pkg>/src/foo.ts          # source
packages/<pkg>/src/foo.test.ts     # unit test
packages/<pkg>/test/foo.test.ts    # integration test
```

Use `node:test` (`describe`, `test`) and `node:assert`. Name tests as behaviors, not implementation details. Every public function needs at least one test.

## Architecture Principles

- **Dependency Injection**: pass dependencies through constructors, never import and instantiate them directly inside a module.
- **Dependency Inversion (DIP)**: high-level packages (`core`, `server`) depend on interfaces defined in `contract`, not on infrastructure packages (`database`, `matter`, `registry`) directly. The composition root (`apps/hub`) wires concrete implementations.
- **Single Responsibility**: one module, one reason to change. If a module does two things, split it.
- **Interface Segregation**: keep interfaces in `contract` small and focused. Consumers should not depend on methods they do not use.

## Workflow

1. Before writing code, understand which package owns the responsibility.
2. Write the test first (TDD: Red → Green → Refactor).
3. Implement the minimum code to pass the test.
4. Run `npm run check` before committing.
5. Keep changes scoped to one package at a time when possible.

## What Not To Do

- Do not add logic to `apps/hub/` beyond wiring dependencies.
- Do not create circular dependencies between packages.
- Do not put infrastructure concerns (database, file system, network) in `core` or `contract`.
- Do not import `@matter/main` outside of `packages/matter/`.
- Do not import `node:sqlite` outside of `packages/database/`.
- Do not validate data between internal packages — trust the boundary.
- Do not skip tests. Every public function needs at least one test.
- Do not modify `bin/home-chip.js` — it is a plain JS deployment wrapper, not part of the TypeScript source.
