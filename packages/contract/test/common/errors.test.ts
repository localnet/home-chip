import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
    type AppError,
    ConflictError,
    IntegrationError,
    InternalError,
    NotFoundError,
    UnauthorizedError,
    UnreachableError,
    ValidationError,
} from "../../src/common/errors.ts";

// `code` travels to clients, which switch on it: changing one of these strings is a
// breaking protocol change, not a refactor. The table pins the whole set in one place,
// along with the rule that derives it — the class name in SCREAMING_SNAKE_CASE.
const SUBCLASSES: readonly (readonly [new (message: string) => AppError, string, string])[] = [
    [ValidationError, "ValidationError", "VALIDATION_ERROR"],
    [NotFoundError, "NotFoundError", "NOT_FOUND_ERROR"],
    [ConflictError, "ConflictError", "CONFLICT_ERROR"],
    [UnauthorizedError, "UnauthorizedError", "UNAUTHORIZED_ERROR"],
    [IntegrationError, "IntegrationError", "INTEGRATION_ERROR"],
    [UnreachableError, "UnreachableError", "UNREACHABLE_ERROR"],
    [InternalError, "InternalError", "INTERNAL_ERROR"],
];

describe("common/errors", () => {
    describe("AppError subclasses", () => {
        test("each names itself after its class and fixes its code", () => {
            for (const [Subclass, name, code] of SUBCLASSES) {
                const error = new Subclass("x");
                assert.equal(error.name, name);
                assert.equal(error.code, code);
            }
        });
    });

    describe("AppError constructor", () => {
        test("carries the message, the cause and the data through", () => {
            const cause = new Error("root cause");
            const data = { field: "setupCode", got: "abc" };

            const error = new ValidationError("setupCode must be 11 digits", { cause, data });

            assert.equal(error.message, "setupCode must be 11 digits");
            assert.equal(error.cause, cause);
            assert.deepEqual(error.data, data);
        });

        test("leaves cause and data undefined when no options are given", () => {
            const error = new ConflictError("already paired");

            assert.equal(error.cause, undefined);
            assert.equal(error.data, undefined);
        });
    });
});
