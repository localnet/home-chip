# @home-chip/hub

Composition root. Instantiates and wires all packages.

## Responsibilities

- Instantiate concrete implementations from all packages
- Inject dependencies through constructors
- Start the application

## Dependencies

Direct: all packages except `@home-chip/contract`

## Boundaries

This is the **only** place where concrete implementations are imported and wired together. No logic belongs here beyond instantiation and wiring. If a line of code in this package does anything other than `new` or passing an instance as an argument, it belongs in another package.

## What Does NOT Belong Here

- Business logic of any kind
- Configuration reading (belongs in `system`)
- Any code that would need a unit test
