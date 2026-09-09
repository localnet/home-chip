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
        test("accepts both manual pairing code lengths", () => {
            // 11 digits, and the 21 a device carries when its commissioning flow is non-standard
            // and the code has to name the vendor and the product. Both come from
            // ManualPairingCodeCodec.encode, so they are codes the SDK reads back.
            for (const setupCode of ["34970112332", "749701123365521327687"]) {
                assert.deepEqual(validateCommissionParams({ setupCode }), { setupCode });
            }
        });

        test("accepts the MT: QR payload", () => {
            const setupCode = "MT:Y.K9042C00KA0648G00";
            assert.deepEqual(validateCommissionParams({ setupCode }), { setupCode });
        });

        test("accepts a concatenated payload, which the matter adapter refuses rather than the schema", () => {
            // Well-formed and naming several devices: answering "malformed" here would be a lie.
            assert.doesNotThrow(() => validateCommissionParams({ setupCode: "MT:Y.K9042C00KA*Y.K9042C00KB" }));
        });

        test("bounds one payload at 255 Base38 characters, the MT: prefix not among them", () => {
            assert.doesNotThrow(() => validateCommissionParams({ setupCode: `MT:${"A".repeat(255)}` }));
            assert.throws(() => validateCommissionParams({ setupCode: `MT:${"A".repeat(256)}` }), ValidationError);
        });

        test("bounds the whole code at 4296 characters, the MT: prefix among them", () => {
            // Payloads of the maximum length, so the total is what each case turns on: sixteen of
            // them run to 4098 characters and seventeen to 4354.
            const payloads = (count: number) => `MT:${Array.from({ length: count }, () => "A".repeat(255)).join("*")}`;
            assert.doesNotThrow(() => validateCommissionParams({ setupCode: payloads(16) }));
            assert.throws(() => validateCommissionParams({ setupCode: payloads(17) }), ValidationError);
        });

        test("rejects a manual code of the wrong length or with anything but digits", () => {
            for (const setupCode of [
                "1234567890",
                "123456789012",
                "1234567890a",
                "7497011233655213276871",
                "3497-011-2332",
                "3497 011 2332",
                "abc34970112332",
            ]) {
                assert.throws(() => validateCommissionParams({ setupCode }), ValidationError);
            }
        });

        test("rejects a QR payload outside the Base38 alphabet, a bare prefix, and a bare separator", () => {
            for (const setupCode of ["MT:Y.K9042C00KA0648G00!", "mt:Y.K9042C00KA0648G00", "MT:", "MT:*", "MT:A*"]) {
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
