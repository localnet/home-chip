import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";

import { SqliteTransactor } from "../src/transactor.ts";

const memoryConnection = (): DatabaseSync => {
    const connection = new DatabaseSync(":memory:");
    connection.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;");
    return connection;
};

const rowCount = (connection: DatabaseSync): number =>
    Number((connection.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c);

describe("SqliteTransactor", () => {
    describe("run", () => {
        test("commits and returns the function's result", () => {
            const connection = memoryConnection();

            const result = new SqliteTransactor(connection).run(() => {
                connection.prepare("INSERT INTO t (value) VALUES (?)").run("a");
                return 42;
            });

            assert.equal(result, 42);
            assert.equal(rowCount(connection), 1);
        });

        test("rolls every write back and rethrows the original error", () => {
            const connection = memoryConnection();
            const original = new Error("boom");

            assert.throws(
                () =>
                    new SqliteTransactor(connection).run(() => {
                        connection.prepare("INSERT INTO t (value) VALUES (?)").run("a");
                        connection.prepare("INSERT INTO t (value) VALUES (?)").run("b");
                        throw original;
                    }),
                // The identity matters: a failing ROLLBACK must not replace what the caller needs.
                (error: unknown) => error === original,
            );
            assert.equal(rowCount(connection), 0);
        });

        test("lets SQLite refuse a nested transaction", () => {
            const connection = memoryConnection();
            const transactor = new SqliteTransactor(connection);

            assert.throws(() => transactor.run(() => transactor.run(() => undefined)));
            assert.equal(rowCount(connection), 0);
        });
    });
});
