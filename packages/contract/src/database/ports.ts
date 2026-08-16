/**
 * What a component consumes to bracket writes that span more than one repository inside a single
 * SQLite transaction — commissioning being the case that needs it, since a node and its endpoints
 * have to land together or not at all.
 *
 * Opening the file, applying pending migrations and closing at shutdown are deliberately absent
 * from this interface. They belong to the implementing package's provider, which the composition
 * root builds and drives, so a component holding a `Transactor` can run transactions and nothing
 * else. Migrations in particular are the package's business, not a concept the contract exposes.
 *
 * The repository ports are not methods here either: they live in their own subdomains, and the
 * provider constructs them with whatever handle they need — the SQLite connection — and hands
 * them over ready-made, so that handle never crosses the package boundary.
 */
export interface Transactor {
    /**
     * Runs `transaction` inside a synchronous SQLite transaction, committing on a normal return
     * and rolling back on a throw, which propagates unchanged.
     *
     * Synchronous on purpose. node:sqlite is, and forbidding `await` inside the callback rules
     * out holding a write lock across remote I/O; asynchronous work belongs before or after the
     * transaction, never within it.
     *
     * Nesting is not supported and throws: SQLite has no nested transactions, and SAVEPOINTs are
     * a different mechanism this contract does not expose. Rather than tracking transaction state
     * here, a second `BEGIN` is left to fail on the engine that already owns that state.
     */
    run<T>(transaction: () => T): T;
}
