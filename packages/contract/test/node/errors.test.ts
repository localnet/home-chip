import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { AppError } from "../../src/common/errors.ts";
import { createNodeId } from "../../src/common/ids.ts";
import {
    CommissioningFailedError,
    DecommissioningFailedError,
    DeviceAlreadyCommissionedError,
    NodeAsleepError,
    NodeNotFoundError,
    NodeOfflineError,
    SetupCodeAmbiguousError,
} from "../../src/node/errors.ts";

const id = createNodeId();
const cause = new Error("SDK failure");

// `code` and `data` are what reaches the client, so the table pins both for every error the
// subdomain can raise. `data: undefined` is as much a decision as any payload: an aborted
// commissioning identifies no node to report.
const CASES: readonly { error: AppError; code: string; data?: Record<string, unknown>; cause?: unknown }[] = [
    {
        error: new NodeNotFoundError(id),
        code: "NOT_FOUND_ERROR",
        data: { id },
    },
    {
        error: new CommissioningFailedError(cause),
        code: "INTEGRATION_ERROR",
        cause,
    },
    {
        error: new DecommissioningFailedError(id, cause),
        code: "INTEGRATION_ERROR",
        data: { id },
        cause,
    },
    {
        error: new DeviceAlreadyCommissionedError(),
        code: "CONFLICT_ERROR",
    },
    {
        error: new SetupCodeAmbiguousError(3),
        code: "VALIDATION_ERROR",
        data: { deviceCount: 3 },
    },
    {
        error: new NodeAsleepError(id, cause),
        code: "UNREACHABLE_ERROR",
        data: { id },
        cause,
    },
    {
        error: new NodeOfflineError(id, cause),
        code: "UNREACHABLE_ERROR",
        data: { id },
        cause,
    },
];

describe("node/errors", () => {
    test("each inherits the code of its base class", () => {
        for (const { error, code } of CASES) {
            assert.equal(error.code, code, `${error.name} should carry ${code}`);
        }
    });

    test("each carries exactly what the client can act on in data", () => {
        for (const { error, data } of CASES) {
            assert.deepEqual(error.data, data, `${error.name} data mismatch`);
        }
    });

    test("those wrapping an SDK failure keep the original error in cause", () => {
        for (const expected of CASES) {
            assert.equal(expected.error.cause, expected.cause, `${expected.error.name} cause mismatch`);
        }
    });

    test("asleep and offline read apart in the message, since only one promises a later retry", () => {
        assert.match(new NodeAsleepError(id, cause).message, /asleep/);
        assert.match(new NodeOfflineError(id, cause).message, /offline/);
    });
});
