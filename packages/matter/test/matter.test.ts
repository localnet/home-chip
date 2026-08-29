import "../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { Writable } from "node:stream";
import { describe, test } from "node:test";

import { LogLevel } from "@home-chip/contract/logger/types.ts";

import { createMatterProvider, type MatterDeps, type SdkOptions } from "../src/matter.ts";
import { TestEventBus } from "./helpers/bus.ts";
import { TestLogger } from "./helpers/logger.ts";
import { TestEndpointRepository } from "./helpers/repositories/endpoint.ts";
import { TestNodeRepository } from "./helpers/repositories/node.ts";

const options: SdkOptions = {
    networkInterface: null,
    logLevel: LogLevel.Info,
};

const create = () => {
    const deps: MatterDeps = {
        logger: new TestLogger(),
        bus: new TestEventBus(),
        nodeRepository: new TestNodeRepository(),
        endpointRepository: new TestEndpointRepository(),
        stream: new Writable(),
    };
    return createMatterProvider("/tmp/home-chip-matter-unused", deps, options);
};

describe("matter", () => {
    describe("createMatterProvider", () => {
        test("produces a Lifecycle with start and stop", () => {
            const provider = create();
            assert.equal(typeof provider.start, "function");
            assert.equal(typeof provider.stop, "function");
        });

        test("stop() before start() is a no-op", async () => {
            await assert.doesNotReject(() => create().stop());
        });

        test("accessing node before start() throws", () => {
            assert.throws(() => create().node);
        });

        test("accessing endpoint before start() throws", () => {
            assert.throws(() => create().endpoint);
        });
    });
});
