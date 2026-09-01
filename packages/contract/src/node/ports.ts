import type { NodeId } from "../common/ids.ts";
import type { CommissioningResult, NodeInfo, NodeRecord, NodeState } from "./types.ts";

/**
 * Read-only access to the in-memory state of every node, implemented by the registry. There are
 * no mutators on purpose: the registry updates itself in reaction to the node:* events.
 *
 * Both methods return a point-in-time copy that does not update itself; a consumer tracking
 * changes subscribes to the events rather than holding a reference. Lookups are O(1) by NodeId.
 */
export interface NodeView {
    list(): NodeState[];
    get(id: NodeId): NodeState | null;
}

/**
 * Persistence of node metadata, implemented by the database package. Operations are synchronous
 * because node:sqlite is; an async driver would require revisiting this interface.
 *
 * Only metadata we own is stored. Vendor, product and firmware information never is: it is read
 * on demand from the device's Basic Information cluster.
 *
 * Deleting a node deletes its endpoints, through the `ON DELETE CASCADE` on `endpoints.node_id`.
 * No caller removes them separately, and the bus sees a single `node:removed`.
 */
export interface NodeRepository {
    findById(id: NodeId): NodeRecord | null;

    /**
     * Translates a Matter SDK event, which carries the raw matter node id as a bigint, into our
     * NodeId. The matter adapter is the only caller; everyone else works in NodeId throughout.
     */
    findByMatterId(matterId: bigint): NodeRecord | null;

    findAll(): NodeRecord[];

    /**
     * Inserts the record at the end of commissioning, and in practice never runs again: node
     * records are immutable once written, since no mutable per-node state is persisted.
     *
     * During commissioning it must be called before any endpoint record, because the FK
     * constraint on endpoints requires the parent row to exist.
     */
    save(record: NodeRecord): void;

    /**
     * Removes the record, once the matter adapter has confirmed the node left the fabric. The
     * endpoints go with it through the FK constraint; the caller does not delete them.
     *
     * Throws NodeNotFoundError if the node does not exist, so a caller can emit `node:removed` on
     * the strength of this call alone rather than reading first to find out whether anything was
     * actually deleted.
     */
    delete(id: NodeId): void;
}

/**
 * Operations on a node that reach the Matter SDK. A Gateway in Fowler's sense: an object that
 * encapsulates access to an external system. Implemented by the matter package.
 *
 * These methods throw either a `node/errors` subclass for a known failure mode or an
 * `IntegrationError` carrying the SDK error in `cause`. A raw SDK error never escapes: the
 * boundary translates it.
 */
export interface NodeGateway {
    /**
     * Commissions a node into our fabric from the onboarding payload printed on the device —
     * either the 11-digit manual pairing code or the QR payload. Resolves with the node record
     * and one record per endpoint found on it.
     *
     * The commissioning use-case is the only consumer of that result, and it completes this
     * sequence before the originating JSON-RPC call returns:
     *
     *   1. Persist the node record and then the endpoint records in a single SQLite transaction —
     *      the FK constraint on endpoints.node_id requires the parent row first.
     *   2. Emit `node:added`, then one `endpoint:added` per endpoint.
     *   3. Only then resolve the response, which carries just the NodeId.
     *
     * That ordering is what lets clients rely on the event model: by the time anyone sees the
     * response — the caller included — the events have already been delivered, so a frontend
     * keeps one subscription to `node:*` and `endpoint:*` and reacts the same way whoever
     * initiated the commissioning.
     *
     * If the transaction fails after the device is already paired, the use-case attempts a
     * best-effort `decommission` to leave it re-pairable. If that also fails, the device is paired
     * on the fabric but unknown locally, and the use-case must surface it so the operator can
     * factory-reset the device.
     *
     * A payload expires 15 minutes after it is generated, and an expired one surfaces as
     * `CommissioningFailedError`. A device that still holds our fabric — commonly one dropped with
     * `decommission(force)` — refuses the attempt as `AlreadyCommissionedError` and needs a
     * factory reset first.
     */
    commission(setupCode: string): Promise<CommissioningResult>;

    /**
     * Removes a node from our fabric. Afterwards we no longer control it, but it stays
     * commissioned in any other ecosystem that shares it. Removing an already-removed node throws
     * NodeNotFoundError.
     *
     * Reaching the device can fail, as NodeAsleepError or NodeOfflineError. `force` is the escape
     * hatch for a device that will not come back: it drops the node locally without removing our
     * fabric from the device, so it never contacts it and cannot report it unreachable. The cost
     * is that the device keeps credentials for a fabric it no longer belongs to and needs a manual
     * factory reset before it can be commissioned again — so a caller should offer it only after
     * the normal path reported the device unreachable.
     */
    decommission(id: NodeId, force?: boolean): Promise<void>;

    /**
     * Whether the node holds a live operational connection right now. Read from the SDK's
     * in-memory view of the fabric — the same source the `node:connected` / `node:disconnected`
     * events derive from — so it never contacts the device and never awaits.
     *
     * It serves the `reachable` field when a view composes a `NodeState` on demand: the database
     * supplies the identity, this supplies whether it is online. Unlike `getInfo`, an unknown id
     * is not an error: a node the SDK does not hold — never commissioned, or database and fabric
     * diverged — is simply not reachable, which is a meaningful answer. That is what lets a view
     * list a persisted-but-unmapped node as offline instead of failing the whole list.
     */
    isReachable(id: NodeId): boolean;

    /**
     * The node's static metadata, from its Basic Information cluster. For detail views and
     * diagnostics, not for every list refresh.
     *
     * Synchronous, and permanently so: the metadata comes from the SDK's cache, populated during
     * the commissioning interview and kept current by its subscriptions, and a live read is
     * neither needed online nor possible offline. Contrast `commission` and `decommission`, which
     * do reach the device.
     *
     * It is the one client-facing read that does not come from the registry, `NodeInfo` being
     * on-demand rather than projected into the in-memory state — which is why it routes through a
     * use-case rather than through a `NodeView`.
     */
    getInfo(id: NodeId): NodeInfo;
}
