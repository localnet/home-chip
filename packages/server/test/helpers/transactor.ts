import type { Transactor } from "@home-chip/contract/database/ports.ts";

/**
 * Transactor fake. By default runs the transaction body and returns its result (a committed
 * transaction). `failWith(error)` makes the next run() throw without executing the body,
 * modelling a transaction that rolls back — so a test can exercise the commission rollback
 * without the writes having landed.
 */
export class TestTransactor implements Transactor {
    #error: Error | undefined;

    failWith(error: Error): void {
        this.#error = error;
    }

    run<T>(transaction: () => T): T {
        if (this.#error !== undefined) {
            throw this.#error;
        }
        return transaction();
    }
}
