# @home-chip/contract

Shared types, interfaces, errors, and validation schemas.

## Responsibilities

- TypeScript types for domain entities (`Device`, `Zone`, etc.)
- Service interfaces (`MatterController`, `DeviceRegistry`, etc.)
- Valibot validation schemas (source of truth for all validation)
- Custom error classes and constants

## Boundaries

This package defines **what**, not **how**. It contains no logic, no side effects, no I/O. Every package except hub depends on contract — it depends on nothing internal.

## External Dependencies

- `valibot` — schema definition and validation

## Validation Strategy

Schemas defined here are the single source of truth. They are consumed at:
- `@home-chip/server` — input validation at the API boundary
- `@home-chip/system` — settings validation on load

Data flowing between internal packages is trusted and not re-validated.

## File Organization

- `src/types/` — TypeScript type definitions
- `src/interfaces/` — service interfaces (ports)
- `src/schemas/` — Valibot schemas
- `src/errors/` — custom error classes
- `src/constants/` — shared constants
- `src/index.ts` — barrel file, re-exports everything public
