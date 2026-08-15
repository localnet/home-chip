import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";

/**
 * Any value an endpoint attribute may hold. Matter defines many structured types — structs,
 * lists, octstrings, fabric-scoped values — but the SDK serializes them all into this shape.
 *
 * `bigint` is here because Matter's 64-bit attribute types (uint64/int64, epoch-us time bases)
 * exceed JavaScript's safe integer range. In-process consumers see the faithful `bigint`; JSON
 * cannot carry one, so the server's wire codec encodes it as a decimal string on the way out and
 * the client parses it back knowing the type from the cluster/attribute identity, as it does for
 * `NodeInfo.matterId`. The value is not self-tagged in-band — neither an "n" suffix nor a wrapper
 * object would be distinguishable from a legitimate string or struct value.
 *
 * Attributes are not typed per cluster: that would mean modelling hundreds of clusters across
 * dozens of spec versions. A consumer of `endpoint:changed` or of a `read` result knows which
 * cluster and attribute it asked for and casts accordingly, with the cluster spec as the source
 * of truth for the shape.
 */
export type AttributeValue =
    | string
    | number
    | bigint
    | boolean
    | null
    | readonly AttributeValue[]
    | { readonly [key: string]: AttributeValue };

/**
 * The latest value the matter adapter received for an attribute, updated continuously through
 * the `endpoint:changed` flow.
 */
export interface AttributeState {
    readonly id: number;
    readonly value: AttributeValue;
}

/**
 * A cluster instance on an endpoint, identified by its Matter cluster id (e.g. 0x0006 for OnOff).
 *
 * `acceptedCommands` is the device's own AcceptedCommandList. It is kept because the spec makes
 * many commands optional, so a device may not implement everything a generic UI would offer:
 * clients consult this list before issuing an invoke.
 */
export interface ClusterState {
    readonly id: number;
    readonly attributes: readonly AttributeState[];
    readonly acceptedCommands: readonly number[];
}

/**
 * The live state of an endpoint, as served by `endpoint.list` and `endpoint.get`.
 *
 * Reachability is absent because it is a node-level property: a frontend crosses `nodeId` with
 * the node's reachability and follows `node:connected` / `node:disconnected` to keep it current.
 *
 * The Matter endpoint number is absent too. It is SDK-level addressing, and its translation to
 * `EndpointId` stays inside the matter package; every domain consumer addresses endpoints only
 * by `EndpointId`.
 */
export interface EndpointState {
    readonly id: EndpointId;
    readonly nodeId: NodeId;

    /**
     * The Matter Device Type, e.g. 0x0100 for OnOff Light or 0x0301 for Thermostat. A single
     * value: the spec guarantees exactly one Application device type per simple endpoint, and the
     * SDK resolves it. Frontends match it against the Matter Device Library for a specialized UI
     * and fall back to a generic cluster view for unknown types.
     */
    readonly deviceType: number;

    /**
     * Always present and non-empty. The matter adapter derives a default at commissioning from
     * the device's Basic Information cluster; `endpoint.setName` replaces it.
     */
    readonly name: string;

    /** The room the user assigned, or `null` if none. Set through `endpoint.setRoom`. */
    readonly roomId: RoomId | null;

    readonly clusters: readonly ClusterState[];
}

/**
 * The portion of an endpoint the matter adapter owns and can produce from the SDK, returned by
 * `EndpointGateway.describe`. Its consumer — the commissioning use-case or the registry —
 * combines it with the database-owned `name` and `roomId` to assemble an `EndpointState`. Keeping
 * it separate is what spares the matter adapter from fabricating fields it does not own.
 *
 * An internal assembly type: there is no `endpoint.getInfo` method and this never crosses the
 * wire. Hence `EndpointShape` and not `EndpointInfo` — the `*Info` vocabulary in this contract
 * means on-demand client-facing diagnostics read over the wire, as in `NodeInfo`.
 */
export interface EndpointShape {
    readonly deviceType: number;
    readonly clusters: readonly ClusterState[];
}

/**
 * What the database holds for an endpoint: only the fields we own and that change over its
 * lifetime. Matter-side data — clusters, attributes, accepted commands, device type — is not
 * persisted; it lives in the SDK's own store, is reconstructed from there on every adapter
 * restart, and is served from the in-memory registry.
 *
 * `matterNumber` is persisted because it is the local key within the node that re-correlates an
 * SDK endpoint back to our `EndpointId` when the identity map is rehydrated. It never appears in
 * `EndpointState`.
 */
export interface EndpointRecord {
    readonly id: EndpointId;
    readonly nodeId: NodeId;
    readonly matterNumber: number;
    readonly name: string;
    readonly roomId: RoomId | null;
}
