import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import * as v from "valibot";

import { ValidationError } from "../../src/common/errors.ts";
import { createNodeId } from "../../src/common/ids.ts";
import { nodeIdSchema, parseOrThrow } from "../../src/internal/valibot.ts";

type Issue = { path: string; message: string };

/** The issues of the ValidationError a failing parse must throw, failing the test if it does not. */
const captureIssues = (schema: v.GenericSchema, input: unknown): Issue[] => {
    try {
        parseOrThrow(schema, input);
    } catch (error) {
        assert.equal(error instanceof ValidationError, true, "expected a ValidationError");
        const issues = (error as ValidationError).data?.issues;
        assert.equal(Array.isArray(issues), true, "expected data.issues to be an array");
        return issues as Issue[];
    }
    return assert.fail("expected parseOrThrow to throw");
};

describe("internal/valibot", () => {
    describe("parseOrThrow", () => {
        test("returns the parsed output on success", () => {
            const schema = v.object({ name: v.string(), age: v.number() });
            assert.deepEqual(parseOrThrow(schema, { name: "Ada", age: 36 }), { name: "Ada", age: 36 });
        });

        test("reports every failing field, each with its dotted path and message", () => {
            const schema = v.object({ user: v.object({ email: v.string() }), age: v.number() });

            const issues = captureIssues(schema, { user: { email: 123 }, age: "old" });

            assert.deepEqual(
                issues.map((issue) => issue.path),
                ["user.email", "age"],
            );
            for (const issue of issues) {
                assert.equal(typeof issue.message, "string");
            }
        });
    });

    describe("nodeIdSchema", () => {
        test("brands a well-formed identifier and rejects anything else", () => {
            const id = createNodeId();
            assert.equal(parseOrThrow(nodeIdSchema, id), id);
            assert.throws(() => parseOrThrow(nodeIdSchema, "not-a-uuid"), ValidationError);
        });
    });
});
