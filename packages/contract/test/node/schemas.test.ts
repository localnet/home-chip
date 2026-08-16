import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "../../src/common/errors.ts";
import { createNodeId } from "../../src/common/ids.ts";
import {
    validateCommissionParams,
    validateDecommissionParams,
    validateGetInfoParams,
    validateGetParams,
    validateListParams,
} from "../../src/node/schemas.ts";

const id = createNodeId();

describe("node/schemas", () => {
    describe("validateListParams", () => {
        test("accepts undefined and an empty object", () => {
            assert.doesNotThrow(() => validateListParams(undefined));
            assert.doesNotThrow(() => validateListParams({}));
        });

        test("rejects a non-object", () => {
            assert.throws(() => validateListParams("nope"), ValidationError);
        });
    });

    describe("validateGetParams / validateGetInfoParams", () => {
        test("both accept a valid node id", () => {
            assert.deepEqual(validateGetParams({ id }), { id });
            assert.deepEqual(validateGetInfoParams({ id }), { id });
        });

        test("rejects a missing id and anything that is not a UUID v7", () => {
            assert.throws(() => validateGetParams({}), ValidationError);
            assert.throws(() => validateGetParams({ id: "not-a-uuid" }), ValidationError);
            // A UUID v1: well-formed, wrong version. Every id in the system is minted as v7.
            assert.throws(() => validateGetParams({ id: "550e8400-e29b-11d4-a716-446655440000" }), ValidationError);
        });
    });

    describe("validateCommissionParams", () => {
        test("accepts the 11-digit manual pairing code", () => {
            assert.deepEqual(validateCommissionParams({ setupCode: "12345678901" }), { setupCode: "12345678901" });
        });

        test("accepts the MT: QR payload", () => {
            const setupCode = "MT:Y.K9042C00KA0648G00";
            assert.deepEqual(validateCommissionParams({ setupCode }), { setupCode });
        });

        test("accepts a concatenated payload, which the matter adapter refuses rather than the schema", () => {
            // Well-formed and naming several devices: answering "malformed" here would be a lie.
            assert.doesNotThrow(() => validateCommissionParams({ setupCode: "MT:Y.K9042C00KA*Y.K9042C00KB" }));
        });

        test("rejects a QR payload past the 255 characters one product's code may have", () => {
            // Core § 5.1.3.2 counts the limit over the whole code, MT: prefix included.
            assert.doesNotThrow(() => validateCommissionParams({ setupCode: `MT:${"A".repeat(252)}` }));
            assert.throws(() => validateCommissionParams({ setupCode: `MT:${"A".repeat(253)}` }), ValidationError);
        });

        test("rejects a manual code of the wrong length or with non-digits", () => {
            for (const setupCode of ["1234567890", "123456789012", "1234567890a"]) {
                assert.throws(() => validateCommissionParams({ setupCode }), ValidationError);
            }
        });

        test("rejects a QR payload outside the Base38 alphabet, and a bare prefix", () => {
            for (const setupCode of ["MT:Y.K9042C00KA0648G00!", "mt:Y.K9042C00KA0648G00", "MT:"]) {
                assert.throws(() => validateCommissionParams({ setupCode }), ValidationError);
            }
        });

        test("rejects a missing setupCode", () => {
            assert.throws(() => validateCommissionParams({}), ValidationError);
        });
    });

    describe("validateDecommissionParams", () => {
        test("defaults force to false, so the proper fabric removal is tried first", () => {
            assert.deepEqual(validateDecommissionParams({ id }), { id, force: false });
        });

        test("accepts an explicit force", () => {
            assert.deepEqual(validateDecommissionParams({ id, force: true }), { id, force: true });
        });

        test("rejects a non-boolean force and a non-UUID id", () => {
            assert.throws(() => validateDecommissionParams({ id, force: "yes" }), ValidationError);
            assert.throws(() => validateDecommissionParams({ id: "not-a-uuid" }), ValidationError);
        });
    });
});
