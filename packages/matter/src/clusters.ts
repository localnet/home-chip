// Import the SDK isolation side effect before any "@matter/main" import (see sdk-config.ts).
import "./sdk-config.ts";

import { Matter } from "@matter/main/model";
import type { Specifier } from "@matter/main/protocol";
import { ClusterType } from "@matter/main/types";

/**
 * The contract speaks in numeric Matter ids; the SDK's write and invoke requests address
 * through the typed cluster model, taking a cluster descriptor and naming the element. This map
 * bridges the two, built once from the Matter catalog.
 *
 * Reads need none of it: interaction.read takes a numeric attribute path and returns a plain
 * value. Writes and invokes encode against the element's schema, so they need the descriptor and
 * the name.
 */
export interface ClusterEntry {
    /**
     * The cluster descriptor the SDK's Write and Invoke requests accept. The model overload of
     * ClusterType returns `object`, so the shape is asserted once here rather than at each call
     * site, and the names below are read through it.
     */
    readonly cluster: Specifier.ClusterLike;
    /** Command name keyed by numeric command id, e.g. 1 -> "on". */
    readonly commandNames: ReadonlyMap<number, string>;
    /** Attribute name keyed by numeric attribute id, e.g. 0 -> "onOff". */
    readonly attributeNames: ReadonlyMap<number, string>;
}

function build(): ReadonlyMap<number, ClusterEntry> {
    const map = new Map<number, ClusterEntry>();
    for (const model of Matter.clusters) {
        if (model.id === undefined) {
            continue;
        }
        // Named from the descriptor and not from the model's own elements, because the descriptor
        // is what the request resolves against: Specifier.commandFor takes the name to
        // `cluster.commands[name]` and refuses anything else, so a name the model has and the
        // descriptor does not is one the SDK rejects before the device is contacted. The model
        // holds three kinds of those — a response command, which shares its id with the request it
        // answers and would overwrite it here; an element the spec disallows on this cluster, such
        // as RvcOperationalState's Start or the BasicInformation attributes the bridged variant
        // does not serve; and a global attribute, which resolves but is not writable anyway. What
        // the descriptor omits is therefore what we should refuse ourselves, as a not-found error
        // carrying the ids, rather than let the SDK refuse it as a malformed request.
        const cluster = ClusterType(model) as Specifier.ClusterLike;
        const commandNames = new Map<number, string>();
        const attributeNames = new Map<number, string>();
        for (const [name, command] of Object.entries(cluster.commands ?? {})) {
            commandNames.set(command.id, name);
        }
        for (const [name, attribute] of Object.entries(cluster.attributes ?? {})) {
            attributeNames.set(attribute.id, name);
        }
        map.set(model.id, { cluster, commandNames, attributeNames });
    }
    return map;
}

/**
 * The cluster model map, built once at module load. The Matter catalog is static, so a
 * single shared instance serves every gateway without per-call cost.
 */
export const clusterModel: ReadonlyMap<number, ClusterEntry> = build();
