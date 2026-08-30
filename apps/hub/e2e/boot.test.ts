import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { freshRoot, PORT, startHub } from "./helpers/hub.ts";

/**
 * The boot the unit suite cannot reach. `apps/hub/test` covers the paths that end before the
 * Matter controller is created; getting past it needs mDNS over multicast on an IPv6 stack, which
 * Matter mandates. Hence a separate directory, script and CI job: on a host without IPv6 these
 * fail, and they must not take the unit tests down with them.
 */
describe("hub boot", () => {
    test("starts every component and announces where it listens", async (t) => {
        const hub = await startHub(t);

        // The composite line, written only once all five components are up and the server is
        // listening. Awaited rather than read: the stream writes asynchronously, so a line the
        // hub logged a moment ago need not have reached the file yet.
        await hub.awaitLog(new RegExp(`NOTICE Hub ready 0\\.0\\.0\\.0:${PORT}`));
    });

    test("creates its storage and log trees where the environment points", async (t) => {
        const { environment } = await startHub(t);

        // The hub creates the two roots; the matter subtree under each belongs to whoever writes
        // into it, which by boot time has happened.
        assert.equal(existsSync(join(environment.logPath, "hub.log")), true);
        assert.equal(existsSync(join(environment.logPath, "matter", "hub.log")), true);
        assert.equal(existsSync(join(environment.storagePath, "hub.db")), true);
        assert.equal(existsSync(join(environment.storagePath, "matter")), true);
    });

    test("comes back up on the same directory after a clean stop", async (t) => {
        // What a service manager does on every upgrade, and the path where a provider that failed
        // to release something — the port, the mDNS socket, an identity map left populated —
        // shows up as a second boot that never arrives.
        const root = freshRoot();
        const first = await startHub(t, { root });
        await first.stop();

        const second = await startHub(t, { root });

        // The same file, so both boots are in it: the second reused the storage rather than
        // starting from an empty tree, and the ports and the mDNS socket were released in time.
        const contents = await second.awaitLog(/NOTICE Hub ready[\s\S]*NOTICE Hub ready/);
        assert.equal(contents.match(/NOTICE Hub ready/g)?.length, 2);
    });
});
