// Pure side-effect module: isolates the SDK from MATTER_* environment variables, process argv
// and its own config file, so HomeChip's configuration is the single source of truth. It has to
// be evaluated before any other "@matter/main" import, which ESM's load order guarantees as long
// as every SDK-touching module imports this one first. Forgetting it makes the SDK throw at
// startup rather than quietly losing the isolation, so the requirement enforces itself.
//
// The file holds this import and these assignments and nothing else, so import sorting cannot
// move a value import ahead of them and re-enable the lookups.
//
// It is the one place here that reaches into "@matter/nodejs" instead of "@matter/main", `config`
// living there with no equivalent re-exported. It is deliberately undeclared as a dependency:
// "@matter/main" already depends on it as an optionalDependency pinned to its exact version, so
// bumping "@matter/main" keeps them in lockstep. Declaring it would allow a skew, which npm
// resolves with a second nested copy — and since `config` is a module-level singleton, we would
// configure one instance while the SDK reads another, silently restoring everything this file
// disables. An undeclared import that stops resolving fails loudly at boot; a duplicated
// singleton would not fail at all. Revisit only under a strict node_modules layout such as
// pnpm's, and then pin the exact version "@matter/main" requires.
import { config } from "@matter/nodejs/config";

config.loadProcessEnv = false;
config.loadProcessArgv = false;
config.loadConfigFile = false;

// SQLite over the default JSON file driver: atomic, transactional persistence of the fabric
// credentials, and gentler on an SD card. It belongs here rather than beside the path in
// environment.ts because the storage service reads its driver once, while the environment is
// constructed, which this module runs before. The path can stay there: it depends on a runtime
// argument this module does not have, and the SDK reads it lazily on every use.
config.storageDriver = "sqlite";

// The SDK traps SIGINT, SIGTERM, SIGUSR2 and SIGABRT, platform depending, and runs a shutdown of
// its own on each. The hub's entry point already owns the first two — it stops everything in
// order and exits — so there the SDK's handlers only race it: on Ctrl+C both shut down at once
// and the SDK keeps writing to matter/hub.log after the hub has closed it. One owner of those
// signals removes the race. The other two are left to Node's default deliberately: neither is
// part of how the hub is stopped, and an abort is not something to meet with an orderly
// shutdown.
config.trapProcessSignals = false;

// Kept on, and set rather than left to the default so that a flip in a patch release cannot take
// it away quietly. It is narrower than its name suggests: it adds an uncaughtExceptionMonitor
// listener, a monitor rather than a handler, so Node still dies the way it would have, and it
// does nothing at all for an unhandled rejection. What it buys is the report, written through the
// SDK's own Logger — so an uncaught exception reaches matter/hub.log rather than hub.log, nothing
// here installing a handler of its own. An odd file for it, and better than stderr alone, which
// is where it would go otherwise.
config.trapUnhandledErrors = true;
