import type { NodeId } from "../common/ids.ts";
import type { EndpointRecord } from "../endpoint/types.ts";

/**
 * The live state of a node, as served by `node.list` and `node.get`. Deliberately minimal: the
 * identity and the one property that changes during normal operation. Static metadata — vendor,
 * product, firmware, the underlying Matter Node ID — is served on demand by `node.getInfo`.
 */
export interface NodeState {
    readonly id: NodeId;

    /**
     * Whether the SDK currently holds an active session with the node and it answers commands.
     * Kept current by `node:connected` and `node:disconnected`. False does not mean the node is
     * gone, only that it cannot be reached right now.
     */
    readonly reachable: boolean;
}

/**
 * A node's static metadata, served on demand by `node.getInfo` rather than carried in the live
 * state: it barely changes over a commissioned node's lifetime, so projecting it into every
 * `node.list` would waste bandwidth. The matter adapter sources it from the Basic Information
 * cluster on the node's endpoint 0.
 */
export interface NodeInfo {
    readonly id: NodeId;

    /**
     * The native Matter Node ID (uint64) this node holds in our fabric, in hexadecimal with an
     * `0x` prefix. A string because JSON has no 64-bit integer, and hexadecimal because that is
     * how the SDK writes a node in its own log, so the two read alike — the log's form is this
     * one without the prefix.
     *
     * The prefix stays because it is what lets a client parse the value back with BigInt: without
     * it, an id whose digits happen to be decimal would parse as a decimal number and be silently
     * wrong.
     *
     * Diagnostic detail, not an address the domain uses — consumers refer to the node by its
     * `NodeId`. The same value as `NodeRecord.matterId`.
     */
    readonly matterId: string;

    /**
     * Epoch milliseconds of commissioning, as the device's own commissioning state reports it.
     * Null when the SDK does not supply it: the value is not persisted, so it is served live and
     * may be absent rather than fabricated.
     */
    readonly commissionedAt: number | null;

    /**
     * The device's own NodeLabel, from Basic Information. Any administrator on any fabric can
     * write it, so it is the closest thing to a name the device carries across ecosystems: a label
     * set in Apple Home shows up here. We only read it — renaming what the user controls is done
     * per endpoint, through `endpoint.setName`, and stays ours.
     *
     * Empty when the device has no label set, which is the common case out of the box. A client
     * wanting one string to show falls back to `productName` itself; that decision is not made
     * here, so it can tell a labelled device from an unlabelled one.
     */
    readonly label: string;

    /** Reported by the device, and empty when it does not populate Basic Information properly. */
    readonly vendorName: string;
    readonly productName: string;

    /** Vendor and product identifiers assigned by the Connectivity Standards Alliance. */
    readonly vendorId: number;
    readonly productId: number;

    /**
     * As reported by the device. The version string is human-readable ("1.4.2"); the numeric
     * version is the monotonically increasing value OTA decisions are made on.
     */
    readonly hardwareVersion: number;
    readonly softwareVersion: number;
    readonly softwareVersionString: string;
}

/**
 * What the database holds for a node, and what crosses between the matter adapter — which knows
 * the bigint Matter node id — and the repository that stores it. Distinct from `NodeState`: that
 * is the live view served to clients, this is the durable shape.
 *
 * `matterId` is the native Matter Node ID (uint64), the key the adapter uses to translate SDK
 * events back into our `NodeId`. It never appears in `NodeState`; its only client-facing form is
 * the string in `NodeInfo`.
 */
export interface NodeRecord {
    readonly id: NodeId;
    readonly matterId: bigint;
}

/**
 * What a successful commissioning yields: the node and one record per endpoint the adapter found
 * on the device. Each `EndpointRecord` already carries its default `name`, derived from the
 * node's Basic Information during the commissioning interview and therefore available without a
 * further round-trip. Basic Information is node-level, so naming several application endpoints
 * apart is the adapter's concern.
 *
 * The commissioning use-case consumes this and owns everything that follows — persistence,
 * events, and what happens when either fails. `NodeGateway.commission` documents that sequence.
 */
export interface CommissioningResult {
    readonly node: NodeRecord;
    readonly endpoints: readonly EndpointRecord[];
}
