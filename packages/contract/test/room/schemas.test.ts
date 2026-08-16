import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ValidationError } from "../../src/common/errors.ts";
import { createRoomId } from "../../src/common/ids.ts";
import {
    validateAddParams,
    validateGetParams,
    validateListParams,
    validateRemoveParams,
    validateSetNameParams,
} from "../../src/room/schemas.ts";

const id = createRoomId();

describe("room/schemas", () => {
    describe("validateListParams", () => {
        test("accepts undefined and an empty object", () => {
            assert.doesNotThrow(() => validateListParams(undefined));
            assert.doesNotThrow(() => validateListParams({}));
        });

        test("rejects a non-object", () => {
            assert.throws(() => validateListParams("nope"), ValidationError);
        });
    });

    describe("validateGetParams / validateRemoveParams", () => {
        test("both accept a valid room id", () => {
            assert.deepEqual(validateGetParams({ id }), { id });
            assert.deepEqual(validateRemoveParams({ id }), { id });
        });

        test("rejects a missing id and a non-UUID one", () => {
            assert.throws(() => validateGetParams({}), ValidationError);
            assert.throws(() => validateGetParams({ id: "not-a-uuid" }), ValidationError);
        });
    });

    describe("validateAddParams", () => {
        // The name bounds are pinned here alone: add and setName share roomNameSchema, so
        // asserting them twice would test one schema through two doors.
        test("accepts anything within [1, 64] characters, unicode included", () => {
            assert.deepEqual(validateAddParams({ name: "Living Room" }), { name: "Living Room" });
            for (const name of ["L", "x".repeat(64), "Salón 🛋️"]) {
                assert.doesNotThrow(() => validateAddParams({ name }));
            }
        });

        test("rejects an empty name, an over-long one, a non-string and a missing one", () => {
            for (const name of ["", "x".repeat(65), 42]) {
                assert.throws(() => validateAddParams({ name }), ValidationError);
            }
            assert.throws(() => validateAddParams({}), ValidationError);
        });
    });

    describe("validateSetNameParams", () => {
        test("accepts an id and a name together", () => {
            assert.deepEqual(validateSetNameParams({ id, name: "Kitchen" }), { id, name: "Kitchen" });
        });

        test("rejects a missing id", () => {
            assert.throws(() => validateSetNameParams({ name: "Kitchen" }), ValidationError);
        });
    });
});
