import "../src/sdk-config.ts";

import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { Specifier } from "@matter/main/protocol";

import { clusterModel } from "../src/clusters.ts";

describe("clusters", () => {
    describe("clusterModel", () => {
        test("names every element so the SDK resolves it back to the same id", () => {
            // Run against Specifier, which is what Write and Invoke resolve a name through: one it
            // refuses reaches the SDK as a malformed request instead of reaching the device, and
            // one it resolves to another id addresses the wrong element. Checked over the whole
            // catalog rather than a chosen cluster, the catalog being the SDK's to change.
            for (const [clusterId, entry] of clusterModel) {
                const cluster = `0x${clusterId.toString(16)}`;

                for (const [commandId, name] of entry.commandNames) {
                    const resolved = Specifier.commandFor(entry.cluster, name);
                    assert.equal(resolved.id, commandId, `cluster ${cluster} command "${name}"`);
                }
                for (const [attributeId, name] of entry.attributeNames) {
                    const resolved = Specifier.attributeFor(entry.cluster, name);
                    assert.equal(resolved.id, attributeId, `cluster ${cluster} attribute "${name}"`);
                }
            }
        });

        test("keeps the request where a response shares its command id", () => {
            // Groups AddGroup and AddGroupResponse are both command 0, and the model yields the
            // response last, so naming elements from there hands the invoke path a name no cluster
            // defines. This is the shape that trap takes if it comes back.
            const groups = clusterModel.get(0x04);

            assert.ok(groups !== undefined);
            assert.equal(groups.commandNames.get(0x00), "addGroup");
        });

        test("omits what the cluster does not serve, leaving it to the gateway's own error", () => {
            // Elements the spec disallows on the cluster: RvcOperationalState serves no Start, and
            // the bridged variant of BasicInformation serves none of the node-wide attributes.
            // Absent here, they come back as CommandNotFound / AttributeNotFound carrying the ids
            // rather than as a malformed request from inside the SDK.
            const rvcOperationalState = clusterModel.get(0x61);
            const bridgedDeviceBasicInformation = clusterModel.get(0x39);

            assert.ok(rvcOperationalState !== undefined);
            assert.ok(bridgedDeviceBasicInformation !== undefined);
            assert.equal(rvcOperationalState.commandNames.get(0x02), undefined);
            assert.equal(bridgedDeviceBasicInformation.attributeNames.get(0x06), undefined);
        });
    });
});
