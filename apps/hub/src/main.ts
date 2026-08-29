import { join } from "node:path";
import { inspect } from "node:util";

import { loadConfig } from "@home-chip/config/config.ts";
import { resolveEnvironment } from "@home-chip/config/environment.ts";
import type { Lifecycle } from "@home-chip/contract/common/lifecycle.ts";

import { createHubProvider } from "./hub.ts";

/** How a service manager (systemd, Docker) or a terminal asks the hub to stop. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM"] as const;

/** Whether a shutdown is already under way, so a second signal is ignored rather than racing. */
let stopping = false;

async function stop(hub: Lifecycle): Promise<void> {
    if (stopping) {
        return;
    }
    stopping = true;
    await hub.stop();
    // A deterministic end rather than waiting for the event loop to drain: a component that
    // leaves a handle behind would hold the process open past its shutdown and a service manager
    // would end up killing it. The logs are already flushed by here.
    process.exit(0);
}

/**
 * The process boundary: what belongs to running as an OS process rather than to composing the hub
 * — reading the environment and the config file, reporting to stderr, handling signals, choosing
 * the exit code. `hub.ts` is handed the result and stays a pure object graph.
 */
try {
    const environment = resolveEnvironment();
    const config = loadConfig(join(environment.configPath, "hub.json"));
    const hub = createHubProvider(environment, config);

    await hub.start();

    // Registered only once the hub is up: a signal arriving mid-boot would race stop() against
    // start(), and until then terminating, which is the default, is the right answer anyway.
    for (const signal of STOP_SIGNALS) {
        process.on(signal, () => void stop(hub));
    }
} catch (error) {
    // The hub logs to hub.log, which does not exist yet if the failure came early and which an
    // operator in the foreground never looks at, so a boot failure is announced here too.
    // Rendered with inspect, as the logger renders its own values: an AppError carries the
    // actionable part — which variable, which field — in `data`, which a stack trace would drop.
    // The explicit exit is not decoration either: a component that failed to start can leave a
    // handle behind, as the Matter SDK's mDNS socket does, and the hub would hang instead of
    // dying.
    process.stderr.write(`home-chip failed to start: ${inspect(error)}\n`);
    process.exit(1);
}
