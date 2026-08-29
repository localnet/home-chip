// Import the SDK isolation side effect before any "@matter/main" import (see sdk-config.ts).
import "./sdk-config.ts";

import { AttributeModel, CommandModel, Matter } from "@matter/main/model";
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
     * ClusterType is typed as `object`, so that is what we carry; the requests validate the shape
     * at the call site.
     */
    readonly cluster: object;
    /** Command name keyed by numeric command id, e.g. 1 -> "on". */
    readonly commandNames: ReadonlyMap<number, string>;
    /** Attribute name keyed by numeric attribute id, e.g. 0 -> "onOff". */
    readonly attributeNames: ReadonlyMap<number, string>;
}

/** The SDK names elements in camelCase ("on", "onOff"); the model has them in PascalCase. */
const camelize = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

function build(): ReadonlyMap<number, ClusterEntry> {
    const map = new Map<number, ClusterEntry>();
    for (const model of Matter.clusters) {
        if (model.id === undefined) {
            continue;
        }
        const commandNames = new Map<number, string>();
        const attributeNames = new Map<number, string>();
        for (const ace of model.allAces) {
            if (ace.id === undefined) {
                continue;
            }
            if (ace instanceof CommandModel) {
                commandNames.set(ace.id, camelize(ace.name));
            } else if (ace instanceof AttributeModel) {
                attributeNames.set(ace.id, camelize(ace.name));
            }
        }
        map.set(model.id, { cluster: ClusterType(model), commandNames, attributeNames });
    }
    return map;
}

/**
 * The cluster model map, built once at module load. The Matter catalog is static, so a
 * single shared instance serves every gateway without per-call cost.
 */
export const clusterModel: ReadonlyMap<number, ClusterEntry> = build();
