// Import the SDK isolation side effect before any "@matter/main" import (see sdk-config.ts).
import "./sdk-config.ts";

import type { Writable } from "node:stream";

import { InternalError } from "@home-chip/contract/common/errors.ts";
import type { MatterConfig } from "@home-chip/contract/config/schemas.ts";
import type { LogLevel } from "@home-chip/contract/logger/types.ts";
import { Environment, LogFormat, Logger } from "@matter/main";

/**
 * The Matter controller configuration the provider needs. Intersected with the
 * contract's MatterConfig so new SDK settings (Thread, vendor metadata) flow in
 * automatically as that type grows; `logLevel` is the extra the SDK logger needs. Kept
 * to pure Matter configuration — no paths, no collaborators. Defined here, where the
 * SDK config is applied, and re-exported from `matter.ts` for the package's public API.
 */
export type SdkOptions = MatterConfig & {
    readonly logLevel: LogLevel;
};

/**
 * Configures the SDK's global environment with HomeChip's values and points its logger at our
 * `matter/hub.log` stream. Returns `Environment.default`, a fully provisioned NodeJsEnvironment
 * where a bare `new Environment()` would lack crypto, network and storage. One environment per
 * process means one controller per process, which is what a hub is.
 *
 * `rootPath` is where the SDK keeps the node's state: matter's subtree of the hub's storage, not
 * a backup unit of its own — the fabric credentials there and the node records in the database
 * only mean anything together.
 *
 * The integration tests build their own Environment with mocked crypto and storage and a
 * simulated network instead, `default` being a process-global that could neither isolate one
 * test from another nor host several simulated nodes at once.
 */
export function configureEnvironment(rootPath: string, stream: Writable, options: SdkOptions): Environment {
    const environment = Environment.default;

    // Our storage root. Set as a var because the SDK reads the path lazily, on every use, so
    // a value set here still takes. (The driver is chosen in sdk-config.ts instead: the SDK
    // reads that one once, before this function runs.)
    environment.vars.set("storage.path", rootPath);

    // The SDK ships a destination named "default" writing to the console, whose write we
    // redirect. Destinations are mutable so the type allows undefined, but "default" is always
    // there at boot: its absence is a broken invariant, not a case to handle.
    const destination = Logger.destinations.default;
    if (destination === undefined) {
        throw new InternalError("SDK has no default log destination");
    }
    destination.write = (text: string) => {
        stream.write(`${text}\n`);
    };

    // Its native plain format is kept rather than routing through our logger, so a line from the
    // SDK reads the same here as it does upstream. Our LogLevel values are the SDK's own level
    // names, which Logger.level takes as they are.
    Logger.format = LogFormat.PLAIN;
    Logger.level = options.logLevel;

    // Limit mDNS to one interface when configured (e.g. "wlan0"); null lets the SDK use
    // every available interface, which is the right default on a single-homed hub.
    if (options.networkInterface !== null) {
        environment.vars.set("mdns.networkInterface", options.networkInterface);
    }

    return environment;
}
