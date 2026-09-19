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
        test("accepts a name, held to the shared name rule", () => {
            // nameSchema, bounds included, is pinned in the endpoint tests; this checks that rooms
            // reach it, through two of its rules a plain string schema would not apply.
            assert.deepEqual(validateAddParams({ name: "Living Room" }), { name: "Living Room" });
            assert.deepEqual(validateAddParams({ name: `Sal${"o\u0301"}n` }), { name: "Salón" });
            assert.throws(() => validateAddParams({ name: "Salón 😂" }), ValidationError);
        });

        test("rejects a missing name", () => {
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
