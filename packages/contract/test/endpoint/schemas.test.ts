import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "../../src/common/errors.ts";
import { createEndpointId, createRoomId } from "../../src/common/ids.ts";
import {
    validateGetParams,
    validateInvokeParams,
    validateListParams,
    validateReadParams,
    validateSetNameParams,
    validateSetRoomParams,
    validateWriteParams,
} from "../../src/endpoint/schemas.ts";

const id = createEndpointId();

describe("endpoint/schemas", () => {
    describe("validateListParams", () => {
        test("accepts undefined and an empty object", () => {
            assert.doesNotThrow(() => validateListParams(undefined));
            assert.doesNotThrow(() => validateListParams({}));
        });

        test("rejects a non-object", () => {
            assert.throws(() => validateListParams("nope"), ValidationError);
        });
    });

    describe("validateGetParams", () => {
        test("accepts a valid endpoint id", () => {
            assert.deepEqual(validateGetParams({ id }), { id });
        });

        test("rejects a non-UUID id and a missing one", () => {
            assert.throws(() => validateGetParams({ id: "abc" }), ValidationError);
            assert.throws(() => validateGetParams({}), ValidationError);
        });
    });

    describe("validateReadParams", () => {
        test("accepts the id triple", () => {
            const result = validateReadParams({ id, clusterId: 0x0006, attributeId: 0x0000 });
            assert.deepEqual(result, { id, clusterId: 0x0006, attributeId: 0x0000 });
        });

        test("accepts the whole 32-bit identifier range, manufacturer prefixes included", () => {
            // The upper 16 bits carry the MEI vendor prefix, so a manufacturer-specific cluster
            // sits well above 0xffff and must pass.
            assert.doesNotThrow(() => validateReadParams({ id, clusterId: 0x0000, attributeId: 0x0000 }));
            assert.doesNotThrow(() => validateReadParams({ id, clusterId: 0x130afc01, attributeId: 0x130a0000 }));
            assert.doesNotThrow(() => validateReadParams({ id, clusterId: 0xfffffffe, attributeId: 0xfffffffe }));
        });

        test("rejects 0xffffffff, which addresses a wildcard rather than one element", () => {
            assert.throws(() => validateReadParams({ id, clusterId: 0xffffffff, attributeId: 0 }), ValidationError);
            assert.throws(
                () => validateReadParams({ id, clusterId: 0x0006, attributeId: 0xffffffff }),
                ValidationError,
            );
        });

        test("rejects values outside the range or not whole", () => {
            assert.throws(() => validateReadParams({ id, clusterId: 0x100000000, attributeId: 0 }), ValidationError);
            assert.throws(() => validateReadParams({ id, clusterId: 0x0006, attributeId: -1 }), ValidationError);
            assert.throws(() => validateReadParams({ id, clusterId: 6.5, attributeId: 0x0000 }), ValidationError);
        });
    });

    describe("validateWriteParams", () => {
        test("accepts every JSON-serializable value shape", () => {
            for (const value of [0, "on", true, [1, 2], { field: 3 }]) {
                assert.doesNotThrow(() => validateWriteParams({ id, clusterId: 0x0201, attributeId: 0x0012, value }));
            }
        });

        test("accepts null as the value, which clears a nullable attribute", () => {
            // The contrast with invoke: there a null root means "no arguments" and is refused,
            // here it is the value being written.
            const params = { id, clusterId: 0x0201, attributeId: 0x0012, value: null };
            assert.deepEqual(validateWriteParams(params), params);
        });

        test("rejects a missing value: there is no such thing as writing nothing", () => {
            assert.throws(() => validateWriteParams({ id, clusterId: 0x0201, attributeId: 0x0012 }), ValidationError);
        });
    });

    describe("validateInvokeParams", () => {
        test("accepts args omitted, empty, flat, or deeply nested", () => {
            const accepted = [
                undefined,
                {},
                { level: 128, transitionTime: 10 },
                { items: [1, "x", null], n: { a: [] } },
            ];
            for (const args of accepted) {
                assert.doesNotThrow(() => validateInvokeParams({ id, clusterId: 0x0008, commandId: 0x0000, args }));
            }
        });

        test("rejects values JSON cannot carry", () => {
            for (const args of [{ fn: () => 1 }, { x: undefined }]) {
                assert.throws(
                    () => validateInvokeParams({ id, clusterId: 0x0006, commandId: 0x0000, args }),
                    ValidationError,
                );
            }
        });

        test("rejects a null args root, since absence is expressed by omission", () => {
            assert.throws(
                () => validateInvokeParams({ id, clusterId: 0x0006, commandId: 0x0000, args: null }),
                ValidationError,
            );
        });

        test("accepts null nested inside args, which is a nullable command field", () => {
            assert.doesNotThrow(() =>
                validateInvokeParams({
                    id,
                    clusterId: 0x0081,
                    commandId: 0x0000,
                    args: { openDuration: null, targetLevel: 50 },
                }),
            );
        });
    });

    describe("validateSetNameParams", () => {
        test("accepts anything within [1, 64] characters, unicode included", () => {
            for (const name of ["L", "x".repeat(64), "Salón 🛋️"]) {
                assert.doesNotThrow(() => validateSetNameParams({ id, name }));
            }
        });

        test("rejects an empty name, an over-long one, and a non-string", () => {
            for (const name of ["", "x".repeat(65), 42]) {
                assert.throws(() => validateSetNameParams({ id, name }), ValidationError);
            }
        });
    });

    describe("validateSetRoomParams", () => {
        test("accepts a valid roomId", () => {
            const roomId = createRoomId();
            assert.deepEqual(validateSetRoomParams({ id, roomId }), { id, roomId });
        });

        test("accepts null, which clears the assignment", () => {
            assert.deepEqual(validateSetRoomParams({ id, roomId: null }), { id, roomId: null });
        });

        test("rejects a non-UUID roomId and a missing one", () => {
            assert.throws(() => validateSetRoomParams({ id, roomId: "not-a-uuid" }), ValidationError);
            assert.throws(() => validateSetRoomParams({ id }), ValidationError);
        });
    });
});
