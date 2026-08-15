import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import type { AppError } from "../../src/common/errors.ts";
import { createEndpointId } from "../../src/common/ids.ts";
import {
    AttributeNotFoundError,
    CommandNotFoundError,
    CommandRejectedError,
    EndpointAsleepError,
    EndpointNotFoundError,
    EndpointOfflineError,
    InteractionFailedError,
    WriteRejectedError,
} from "../../src/endpoint/errors.ts";

const endpointId = createEndpointId();
const cause = new Error("SDK failure");

// `code` and `data` are what reaches the client, so the table pins both for every error the
// subdomain can raise: which base class each one inherits its code from, and the exact lookup it
// hands over. Adding a class here without a row makes the omission visible.
const CASES: readonly { error: AppError; code: string; data: Record<string, unknown>; cause?: unknown }[] = [
    {
        error: new EndpointNotFoundError(endpointId),
        code: "NOT_FOUND_ERROR",
        data: { id: endpointId },
    },
    {
        error: new AttributeNotFoundError(endpointId, 0x0006, 0x0000),
        code: "NOT_FOUND_ERROR",
        data: { endpointId, clusterId: 0x0006, attributeId: 0x0000 },
    },
    {
        error: new CommandNotFoundError(endpointId, 0x0006, 0x0063),
        code: "NOT_FOUND_ERROR",
        data: { endpointId, clusterId: 0x0006, commandId: 0x0063 },
    },
    {
        error: new CommandRejectedError(endpointId, 0x0006, 0x0001, 0x85),
        code: "INTEGRATION_ERROR",
        data: { endpointId, clusterId: 0x0006, commandId: 0x0001, statusCode: 0x85 },
    },
    {
        error: new WriteRejectedError(endpointId, 0x0201, 0x0012, 0x88),
        code: "INTEGRATION_ERROR",
        data: { endpointId, clusterId: 0x0201, attributeId: 0x0012, statusCode: 0x88 },
    },
    {
        error: new InteractionFailedError(endpointId, 0x0006, cause),
        code: "INTEGRATION_ERROR",
        data: { endpointId, clusterId: 0x0006 },
        cause,
    },
    {
        error: new EndpointAsleepError(endpointId, 0x0201, cause),
        code: "UNREACHABLE_ERROR",
        data: { endpointId, clusterId: 0x0201 },
        cause,
    },
    {
        error: new EndpointOfflineError(endpointId, 0x0201, cause),
        code: "UNREACHABLE_ERROR",
        data: { endpointId, clusterId: 0x0201 },
        cause,
    },
];

describe("endpoint/errors", () => {
    test("each inherits the code of its base class", () => {
        for (const { error, code } of CASES) {
            assert.equal(error.code, code, `${error.name} should carry ${code}`);
        }
    });

    test("each carries exactly the lookup that failed in data", () => {
        for (const { error, data } of CASES) {
            assert.deepEqual(error.data, data, `${error.name} data mismatch`);
        }
    });

    test("those wrapping an SDK failure keep the original error in cause", () => {
        for (const expected of CASES) {
            assert.equal(expected.error.cause, expected.cause, `${expected.error.name} cause mismatch`);
        }
    });

    test("each names the endpoint in its message", () => {
        for (const { error } of CASES) {
            assert.match(error.message, new RegExp(endpointId), `${error.name} message mismatch`);
        }
    });
});
