import type { DatabaseSync } from "node:sqlite";

import type { Transactor } from "@home-chip/contract/database/ports.ts";

/**
 * The Transactor capability over a single SQLite connection. The provider builds one as soon as
 * the connection is open and keeps it for its lifetime, so callers run transactions without ever
 * touching the raw handle.
 */
export class SqliteTransactor implements Transactor {
    readonly #connection: DatabaseSync;

    constructor(connection: DatabaseSync) {
        this.#connection = connection;
    }

    /**
     * Commits on a normal return, rolls back and rethrows the original error otherwise.
     *
     * A second BEGIN is left to fail on SQLite rather than tracked here: the engine already owns
     * that state, and its refusal says as much as any check of ours would.
     */
    run<T>(transaction: () => T): T {
        this.#connection.exec("BEGIN");
        let result: T;
        try {
            result = transaction();
        } catch (error) {
            try {
                this.#connection.exec("ROLLBACK");
            } catch {
                // A rollback can only fail if the transaction is already gone, and the caller
                // needs the error that got us here rather than the artifact of undoing it.
            }
            throw error;
        }
        this.#connection.exec("COMMIT");
        return result;
    }
}
