import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { importsFirst } from "../rolldown.config.ts";

/**
 * The check behind the build's guarantee that the SDK isolation is evaluated first. The build runs
 * it on every output, but only ever on the layout rolldown happens to produce, and never on an
 * entry that fails it: rolldown places a chunk's import ahead of everything else on its own, so no
 * source change makes one. Those cases are covered here instead.
 */
describe("importsFirst", () => {
    const specifier = "./sdk-config.js";

    test("accepts the isolation as the first statement, one import per line", () => {
        const code = '#!/usr/bin/env node\nimport "./sdk-config.js";\nimport { join } from "node:path";\n';
        assert.equal(importsFirst(code, specifier), true);
    });

    test("accepts it with every import on one line and no space, as a minified build lays it out", () => {
        const code = '#!/usr/bin/env node\nimport"./sdk-config.js";import{join as e}from"node:path";';
        assert.equal(importsFirst(code, specifier), true);
    });

    test("accepts it without a shebang, and in single quotes", () => {
        assert.equal(importsFirst("import './sdk-config.js';\n", specifier), true);
    });

    test("refuses an entry that imports something else first", () => {
        const code = '#!/usr/bin/env node\nimport { join } from "node:path";\nimport "./sdk-config.js";\n';
        assert.equal(importsFirst(code, specifier), false);
    });

    test("refuses an entry that does not import it at all", () => {
        assert.equal(importsFirst('#!/usr/bin/env node\nimport "@matter/main";\n', specifier), false);
    });

    test("reads the specifier literally, a dot matching only a dot", () => {
        assert.equal(importsFirst('import "./sdk-configXjs";\n', specifier), false);
    });
});
