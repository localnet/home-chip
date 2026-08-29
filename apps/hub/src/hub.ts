import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";

import type { Environment } from "@home-chip/config/environment.ts";
import type { Lifecycle } from "@home-chip/contract/common/lifecycle.ts";
import type { Config } from "@home-chip/contract/config/schemas.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import { createDatabaseProvider } from "@home-chip/database/database.ts";
import { createLogger } from "@home-chip/logger/logger.ts";
import { createStreamProvider } from "@home-chip/logger/stream.ts";
import { createMatterProvider } from "@home-chip/matter/matter.ts";
import { createEventBus } from "@home-chip/registry/bus.ts";
import { createRegistry } from "@home-chip/registry/registry.ts";
import { createServerProvider } from "@home-chip/server/server.ts";
import { CommissionUseCase } from "@home-chip/server/use-cases/commission.ts";
import { DecommissionUseCase } from "@home-chip/server/use-cases/decommission.ts";
import { EndpointUseCase } from "@home-chip/server/use-cases/endpoint.ts";
import { NodeUseCase } from "@home-chip/server/use-cases/node.ts";
import { RoomUseCase } from "@home-chip/server/use-cases/room.ts";

/**
 * The composition root: the one place that knows every package and wires them into a running hub.
 * It resolves nothing — the entry point hands it a resolved environment and config — and holds no
 * domain logic, only constructing, ordering and handing each collaborator to the next.
 *
 * Construction and startup interleave rather than forming two phases, a provider exposing its
 * collaborators only between `start()` and `stop()`: the logger needs an open stream, the matter
 * provider needs the database's repositories, the registry needs the matter gateways. The graph is
 * built as it boots — construct, start, use its getters to construct the next — which is why every
 * component is a local of `#boot`: whoever uses one already holds it.
 *
 * `#started` records what came up, in order, and serves both endings. A failed boot unwinds the
 * ones already running and rethrows; a component that fails cleans up after itself, so only the
 * earlier ones need stopping. A normal shutdown stops everything in reverse, the streams going
 * down last so every other component can still log on its way out.
 */
class HomeChipHub implements Lifecycle {
    readonly #environment: Environment;
    readonly #config: Config;
    readonly #started: Lifecycle[] = [];
    #logger: Logger | undefined;

    constructor(environment: Environment, config: Config) {
        this.#environment = environment;
        this.#config = config;
    }

    async start(): Promise<void> {
        if (this.#started.length > 0) {
            return;
        }
        try {
            await this.#boot();
        } catch (error) {
            // Logged before the unwind, while the stream is still open, so the file says why the
            // hub died rather than simply stopping mid-boot. A failure earlier than the logger has
            // no file to write to and reaches the operator through the rethrow.
            this.#logger?.error("failed to start", error);
            await this.#shutdown();
            throw error;
        }
    }

    async stop(): Promise<void> {
        // The closing bracket of the log: the streams go down inside `#shutdown()`, leaving no
        // destination to announce the shutdown once it is done.
        this.#logger?.notice("stopping");
        await this.#shutdown();
    }

    async #boot(): Promise<void> {
        const { storagePath, logPath, authToken } = this.#environment;
        const { server: serverConfig, logger: loggerConfig, matter: matterConfig } = this.#config;

        // The configured paths are ours to create: resolveEnvironment only resolves them, leaving
        // the filesystem untouched until something means to use it. Only the two roots, the
        // `matter` subdirectory under each being created by whoever writes into it.
        await mkdir(storagePath, { recursive: true });
        await mkdir(logPath, { recursive: true });

        const log = {
            hub: createStreamProvider(join(logPath, "hub.log"), loggerConfig),
            matter: createStreamProvider(join(logPath, "matter", "hub.log"), loggerConfig),
        };
        await this.#launch(log.hub);
        await this.#launch(log.matter);

        const logger = createLogger(log.hub.stream, loggerConfig.level);
        this.#logger = logger;

        const database = createDatabaseProvider(join(storagePath, "hub.db"), logger);
        await this.#launch(database);

        const bus = createEventBus(logger);

        const matter = createMatterProvider(
            join(storagePath, "matter"),
            {
                logger,
                stream: log.matter.stream,
                nodeRepository: database.node,
                endpointRepository: database.endpoint,
                bus,
            },
            { ...matterConfig, logLevel: loggerConfig.level },
        );
        await this.#launch(matter);

        const registry = createRegistry({
            logger,
            nodeRepository: database.node,
            endpointRepository: database.endpoint,
            roomRepository: database.room,
            nodeGateway: matter.node,
            endpointGateway: matter.endpoint,
        });

        const server = createServerProvider(
            {
                logger,
                bus,
                nodeView: registry.node,
                endpointView: registry.endpoint,
                roomView: registry.room,
                commissionUseCase: new CommissionUseCase({
                    logger,
                    nodeRepository: database.node,
                    endpointRepository: database.endpoint,
                    transactor: database.transactor,
                    nodeGateway: matter.node,
                    bus,
                }),
                decommissionUseCase: new DecommissionUseCase({
                    logger,
                    nodeRepository: database.node,
                    nodeGateway: matter.node,
                    bus,
                }),
                nodeUseCase: new NodeUseCase({ nodeGateway: matter.node }),
                endpointUseCase: new EndpointUseCase({
                    endpointRepository: database.endpoint,
                    roomRepository: database.room,
                    endpointGateway: matter.endpoint,
                    bus,
                }),
                roomUseCase: new RoomUseCase({ roomRepository: database.room, bus }),
            },
            // Spread rather than restated field by field: ServerOptions intersects the config
            // section, so a field added there reaches the server without a change here.
            { ...serverConfig, authToken },
        );
        await this.#launch(server);

        // Each component announces its own readiness; this is the composite one, the single line
        // saying the whole hub is up and where it listens.
        this.#logger.notice("ready", `${serverConfig.host}:${serverConfig.port}`);
    }

    async #launch(component: Lifecycle): Promise<void> {
        await component.start();
        this.#started.push(component);
    }

    async #shutdown(): Promise<void> {
        for (const component of this.#started.toReversed()) {
            try {
                await component.stop();
            } catch (error) {
                // A stop() is not supposed to throw, and if one does the remaining components still get
                // theirs rather than leaking behind the broken one — the streams above all, whose end()
                // is what gets the tail of the log to disk before the entry point's process.exit, which
                // waits for no pending write. Swallowed rather than rethrown: the failure is already on
                // record, and a non-zero exit would tell a service manager with a restart-on-failure
                // policy to bring back a hub the operator just stopped.
                if (this.#logger !== undefined) {
                    this.#logger.error("component failed to stop", error);
                } else {
                    process.stderr.write(`component failed to stop: ${inspect(error)}\n`);
                }
            }
        }
        this.#started.length = 0;
        this.#logger = undefined;
    }
}

export function createHubProvider(environment: Environment, config: Config): Lifecycle {
    return new HomeChipHub(environment, config);
}
