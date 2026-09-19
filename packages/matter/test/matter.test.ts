import "../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { Writable } from "node:stream";
import { describe, test } from "node:test";

import { InternalError } from "@home-chip/contract/common/errors.ts";
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

/**
 * Only what holds before start() is covered here. start() runs on the SDK's process-wide default
 * environment and a real network, so the provider's decisions past it are not: rebuilding the
 * identity map from the database, clearing it on stop, and stopping the gateways before the
 * controller closes. They wait on a way to hand the provider an environment of the test's own.
 */
describe("matter", () => {
    describe("createMatterProvider", () => {
        test("stop() before start() is a no-op", async () => {
            await assert.doesNotReject(() => create().stop());
        });

        test("neither gateway is reachable before start()", () => {
            const provider = create();

            assert.throws(() => provider.node, InternalError);
            assert.throws(() => provider.endpoint, InternalError);
        });
    });
});
