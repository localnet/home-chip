import { DatabaseSync } from "node:sqlite";

import { InternalError } from "@home-chip/contract/common/errors.ts";
import type { Lifecycle } from "@home-chip/contract/common/lifecycle.ts";
import { MigrationFailedError } from "@home-chip/contract/database/errors.ts";
import type { Transactor } from "@home-chip/contract/database/ports.ts";
import type { EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import type { NodeRepository } from "@home-chip/contract/node/ports.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";

import { MIGRATIONS } from "./migrations.ts";
import { SqliteEndpointRepository } from "./repositories/endpoint.ts";
import { SqliteNodeRepository } from "./repositories/node.ts";
import { SqliteRoomRepository } from "./repositories/room.ts";
import { SqliteTransactor } from "./transactor.ts";

/**
 * Owns the SQLite connection: opens the file, applies pending migrations, and closes at shutdown.
 * The composition root builds one, starts it early in boot order and stops it last.
 *
 * The transactor and the three repositories it exposes are valid only between `start()` and
 * `stop()`. The raw handle never leaves the package — the provider builds the repositories itself,
 * so its consumers depend on the contract ports and not on node:sqlite.
 */
export interface DatabaseProvider extends Lifecycle {
    readonly transactor: Transactor;
    readonly node: NodeRepository;
    readonly endpoint: EndpointRepository;
    readonly room: RoomRepository;
}

class SqliteDatabaseProvider implements DatabaseProvider {
    readonly #filePath: string;
    readonly #logger: Logger;
    #connection: DatabaseSync | undefined;
    #transactor: Transactor | undefined;
    #node: NodeRepository | undefined;
    #endpoint: EndpointRepository | undefined;
    #room: RoomRepository | undefined;

    constructor(filePath: string, logger: Logger) {
        this.#filePath = filePath;
        this.#logger = logger.get("Database");
    }

    // Each getter names the capability that was reached too early, which a shared helper could
    // not do: it would see an anonymous `T | undefined` and could only report that something was
    // reached outside its window. Reaching any of them there is a wiring bug in the composition
    // root, hence InternalError.

    get transactor(): Transactor {
        if (this.#transactor === undefined) {
            throw new InternalError("Transactor accessed outside its start()/stop() window");
        }
        return this.#transactor;
    }

    get node(): NodeRepository {
        if (this.#node === undefined) {
            throw new InternalError("Node repository accessed outside its start()/stop() window");
        }
        return this.#node;
    }

    get endpoint(): EndpointRepository {
        if (this.#endpoint === undefined) {
            throw new InternalError("Endpoint repository accessed outside its start()/stop() window");
        }
        return this.#endpoint;
    }

    get room(): RoomRepository {
        if (this.#room === undefined) {
            throw new InternalError("Room repository accessed outside its start()/stop() window");
        }
        return this.#room;
    }

    async start(): Promise<void> {
        if (this.#connection !== undefined) {
            return;
        }
        // A file that cannot be opened — permissions, a directory, a corrupt database — throws
        // unwrapped: the native error already carries the path and the reason.
        const connection = new DatabaseSync(this.#filePath);

        // WAL commits with one sequential fsync and lets readers work alongside the writer, both
        // gentler on an SD card than the rollback journal. foreign_keys is what makes the schema's
        // cascades fire; node:sqlite turns it on for us, and setting it anyway keeps the event
        // model from resting on a driver default that plain SQLite does not share.
        //
        // synchronous stays FULL, not the NORMAL that usually pairs with WAL and that matter.js
        // uses for its own store: NORMAL loses the last commits to a power cut, and a lost
        // commissioning leaves the device holding fabric credentials nothing here matches,
        // recoverable only by factory reset. Being the more durable of the two stores is the right
        // way to diverge, an orphan row being cleanable where a forgotten device is not, and the
        // throughput NORMAL buys is worthless where every commit is one operator action.
        //
        // No busy_timeout: it guards against a second process writing, and node:sqlite being
        // synchronous, the wait would block the event loop rather than the query.
        connection.exec("PRAGMA journal_mode = WAL;");
        connection.exec("PRAGMA foreign_keys = ON;");
        connection.exec("PRAGMA synchronous = FULL;");

        // BEGIN and COMMIT work without a schema, so the transactor is built first and the
        // migrations run through it.
        const transactor = new SqliteTransactor(connection);
        this.#migrate(connection, transactor);

        // Assigned last: a start that failed leaves the provider unstarted rather than holding a
        // connection that #migrate has already closed.
        this.#connection = connection;
        this.#transactor = transactor;
        this.#node = new SqliteNodeRepository(connection);
        this.#endpoint = new SqliteEndpointRepository(connection);
        this.#room = new SqliteRoomRepository(connection);

        this.#logger.notice("ready", this.#filePath);
    }

    async stop(): Promise<void> {
        if (this.#connection === undefined) {
            return;
        }
        const connection = this.#connection;

        connection.close();
        this.#connection = undefined;
        this.#transactor = undefined;
        this.#node = undefined;
        this.#endpoint = undefined;
        this.#room = undefined;

        this.#logger.notice("closed");
    }

    #migrate(connection: DatabaseSync, transactor: SqliteTransactor): void {
        const current = (connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
        for (const migration of MIGRATIONS) {
            if (migration.version <= current) {
                continue;
            }
            try {
                // Each migration is atomic: its DDL and the user_version bump commit together, so
                // an interrupted run never leaves a version half applied. The version is
                // interpolated because PRAGMA takes no bound parameter, and it is a literal from
                // our own MIGRATIONS rather than anything external.
                transactor.run(() => {
                    migration.up(connection);
                    connection.exec(`PRAGMA user_version = ${migration.version};`);
                });
                this.#logger.notice("migrated to schema version", migration.version, migration.description);
            } catch (error) {
                // Closed before rethrowing so a failed boot leaves no open handle behind.
                connection.close();
                throw new MigrationFailedError(`${migration.version}:${migration.description}`, error);
            }
        }
    }
}

export function createDatabaseProvider(filePath: string, logger: Logger): DatabaseProvider {
    return new SqliteDatabaseProvider(filePath, logger);
}
