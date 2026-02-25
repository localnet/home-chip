# @home-chip/database

SQLite data access layer using `node:sqlite` directly.

## Responsibilities

- Connection to `home.db` (singleton `DatabaseSync`)
- Centralized migrations
- TypeScript types for the database schema (`DeviceRow`, `ZoneRow`, etc.)
- Reusable prepared statements

## Dependencies

Direct: `@home-chip/contract`, `@home-chip/system`

No external database libraries. Uses `node:sqlite` (built into Node.js 22+) directly, without ORM or query builder.

## Boundaries

This package is pure infrastructure — it provides data access primitives. Domain-aware repositories (e.g., `DeviceRepository`, `ZoneRepository`) are defined as interfaces in `@home-chip/contract` and implemented in `@home-chip/registry`.

This package does NOT manage `matter.db` (the internal database used by matter.js). That file is managed entirely by the Matter SDK within `@home-chip/matter`.

## What Does NOT Belong Here

- Domain logic or business rules
- Repository pattern implementations (interfaces in `contract`, implementations in `registry`)
- Direct Matter SDK interaction
