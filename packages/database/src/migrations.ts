import type { DatabaseSync } from "node:sqlite";

/**
 * A single forward schema migration. The provider applies every one whose `version` exceeds the
 * database's `PRAGMA user_version`, each in its own transaction.
 *
 * There is no `down`. This is a local-first hub with no rollback story: a failed migration aborts
 * startup and recovery is from a backup, so a reverse step would be code that never runs.
 */
export interface Migration {
    readonly version: number;
    readonly description: string;
    readonly up: (connection: DatabaseSync) => void;
}

/**
 * The ordered migration set. `version` must be strictly increasing and contiguous from 1, which is
 * what lets `user_version` stand for "migrations applied so far". Never edit or renumber a released
 * migration — append a new one.
 */
export const MIGRATIONS: readonly Migration[] = [
    {
        version: 1,
        description: "initial schema: rooms, nodes, endpoints",
        up: (connection) => {
            // Parent before child, so the foreign keys below resolve. Column shapes mirror the
            // *Record types of the contract, the durable shape, not the *State views served to
            // clients.
            connection.exec(`
                CREATE TABLE rooms (
                    id   TEXT PRIMARY KEY,
                    name TEXT NOT NULL
                ) STRICT;
            `);

            // matter_id holds a Matter uint64 in a signed 64-bit INTEGER; reconciling the two is
            // the node repository's business.
            connection.exec(`
                CREATE TABLE nodes (
                    id        TEXT PRIMARY KEY,
                    matter_id INTEGER NOT NULL
                ) STRICT;
            `);

            // The two cascades are part of the contract's event model, and `foreign_keys = ON`,
            // set by the provider, is what makes them fire. On node_id, CASCADE deletes a node's
            // endpoints in one statement, so decommissioning emits a single node:removed rather
            // than one event per endpoint. On room_id, SET NULL clears the assignment on the
            // endpoints of a deleted room, likewise reported as a single room:removed.
            connection.exec(`
                CREATE TABLE endpoints (
                    id            TEXT PRIMARY KEY,
                    node_id       TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                    matter_number INTEGER NOT NULL,
                    name          TEXT NOT NULL,
                    room_id       TEXT REFERENCES rooms(id) ON DELETE SET NULL
                ) STRICT;
            `);

            // One index per non-primary-key lookup the repositories make: findByMatterId,
            // findByMatterNumber scoped to a node, and findByNode.
            connection.exec("CREATE UNIQUE INDEX idx_nodes_matter_id ON nodes(matter_id);");
            connection.exec(
                "CREATE UNIQUE INDEX idx_endpoints_node_matter_number ON endpoints(node_id, matter_number);",
            );
            connection.exec("CREATE INDEX idx_endpoints_room_id ON endpoints(room_id);");
        },
    },
];
