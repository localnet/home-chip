import { IntegrationError } from "../common/errors.ts";

/**
 * Applying a schema migration failed. The database package runs its migrations while starting,
 * and the hub treats a failure as fatal: the composition root does not proceed with a schema it
 * could not bring up to date.
 *
 * The wrapper earns its place by adding what the native error lacks. SQLite says what went wrong
 * — a bad statement — but not which migration it came from, so `data.migrationId` carries the
 * stable identifier and `cause` keeps the original. Failures the native error already describes
 * in full, such as the database file not opening, propagate unwrapped.
 */
export class MigrationFailedError extends IntegrationError {
    constructor(migrationId: string, cause: unknown) {
        super("Migration failed", { cause, data: { migrationId } });
    }
}
