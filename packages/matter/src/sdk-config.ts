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

// The SDK installs SIGINT/SIGTERM handlers that run a shutdown of its own. The hub's entry point
// already owns process signals — it stops everything in order and exits — so the SDK's handlers
// only race it: on Ctrl+C both shut down at once and the SDK keeps writing to matter/hub.log
// after the hub has closed it. One owner of the signals removes the race.
config.trapProcessSignals = false;
