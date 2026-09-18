import type { Transactor } from "@home-chip/contract/database/ports.ts";

/**
 * Transactor fake. By default runs the transaction body and returns its result, a committed
 * transaction. After `failWith(error)` it still runs the body and then throws, the way a real one
 * fails at COMMIT with the body's work already done. Failing before the body instead would hide
 * whatever the caller does inside it: an event emitted there would never be seen.
 *
 * The writes are not undone. Whether a failed transaction rolls back is the real transactor's to
 * answer, and the database package's tests answer it; a caller's test asserts what the caller
 * does about the failure.
 */
export class TestTransactor implements Transactor {
    #error: Error | undefined;

    failWith(error: Error): void {
        this.#error = error;
    }

    run<T>(transaction: () => T): T {
        const result = transaction();
        if (this.#error !== undefined) {
            throw this.#error;
        }
        return result;
    }
}
