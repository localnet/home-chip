import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { AttributeValue, EndpointRecord, EndpointShape, EndpointState } from "./types.ts";

/**
 * Read-only access to the in-memory state of every endpoint, implemented by the registry. The
 * registry mutates it internally in reaction to the endpoint:* events and to `setName` /
 * `setRoom`.
 *
 * Both methods return a point-in-time copy that does not update itself; a consumer tracking
 * changes subscribes to the events rather than holding a reference.
 *
 * Every endpoint returned has a corresponding node: orphans — mid-commissioning, or
 * transactionally removed — are never exposed.
 */
export interface EndpointView {
    list(): EndpointState[];
    get(id: EndpointId): EndpointState | null;
}

/**
 * Persistence of endpoint metadata, implemented by the database package. Operations are
 * synchronous (see NodeRepository for the rationale).
 *
 * Unlike NodeRecord, EndpointRecord is mutable: name and roomId change over the endpoint's
 * lifetime. The mutators are granular rather than a generic update, so the repository stays
 * explicit about what changes and the column updates stay minimal.
 */
export interface EndpointRepository {
    findById(id: EndpointId): EndpointRecord | null;

    /**
     * Translates an SDK endpoint — identified by its Matter endpoint number, scoped to a node —
     * into our EndpointId. Null when the node is unknown or has no endpoint with that number.
     */
    findByMatterNumber(nodeId: NodeId, matterNumber: number): EndpointRecord | null;

    findAll(): EndpointRecord[];

    /**
     * Every endpoint of the given node. Used to enumerate what to delete on decommission, and to
     * rebuild a node's identity at hydration.
     */
    findByNode(nodeId: NodeId): EndpointRecord[];

    /**
     * Inserts a new record. Called inside the commissioning transaction, after the node is saved
     * and before the `endpoint:added` events are emitted.
     */
    save(record: EndpointRecord): void;

    /** Updates the user-assigned name, leaving every other field alone. Throws if unknown. */
    setName(id: EndpointId, name: string): void;

    /** Assigns the room, or clears it with `null`. Throws if unknown. */
    setRoom(id: EndpointId, roomId: RoomId | null): void;

    /**
     * Removes one endpoint, for a dynamic removal from a Matter Bridge. Decommissioning a whole
     * node deletes its endpoints in bulk inside the decommission transaction, not through N calls
     * here.
     */
    delete(id: EndpointId): void;
}

/**
 * Operations on an endpoint that reach the Matter SDK. A Gateway in Fowler's sense: an object
 * that encapsulates access to an external system. Implemented by the matter package.
 *
 * These methods throw either an `endpoint/errors` subclass for a known failure mode or an
 * `IntegrationError` carrying the SDK error in `cause`. A raw SDK error never escapes: the
 * boundary translates it.
 */
export interface EndpointGateway {
    /**
     * Reads an attribute. The SDK serves it from its local cache when fresh and pulls from the
     * device when stale; either way the value is what the SDK considers current. A frontend
     * rendering live state follows `endpoint:changed` instead of polling here.
     *
     * Throws AttributeNotFoundError when the device does not serve the path, or
     * EndpointAsleepError / EndpointOfflineError when it cannot be reached.
     */
    read(id: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue>;

    /**
     * Writes an attribute. Resolves when the device answers SUCCESS at the Interaction Model
     * layer; the resulting value arrives separately through `endpoint:changed`, so a caller that
     * needs to confirm the new state follows the event rather than reading back.
     *
     * Writing is how a client changes anything the cluster exposes as an attribute rather than as
     * a command — a thermostat's absolute setpoint, for instance, since Thermostat's
     * SetpointRaiseLower only adjusts relatively.
     *
     * Throws AttributeNotFoundError when the device does not serve the path, WriteRejectedError
     * with the status in `data.statusCode` on a non-SUCCESS answer — including an attempt to
     * write a read-only attribute — or EndpointAsleepError / EndpointOfflineError when the write
     * cannot be delivered.
     */
    write(id: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void>;

    /**
     * Invokes a command. Resolves when the device answers SUCCESS at the Interaction Model layer,
     * meaning it accepted the command; it does not wait for the resulting attribute changes,
     * which arrive asynchronously through `endpoint:changed`.
     *
     * Throws CommandNotFoundError before contacting the device when the command is not in the
     * cluster's AcceptedCommandList, CommandRejectedError with the status in `data.statusCode` on
     * a non-SUCCESS answer, or EndpointAsleepError / EndpointOfflineError when the command cannot
     * be delivered.
     *
     * `args` carries the command's fields as a struct. Omit it for commands that take none: a
     * null `args` is not accepted, absence is expressed by omission.
     */
    invoke(id: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void>;

    /**
     * Assembles the endpoint's Matter-sourced shape — its device type and the current state of
     * its clusters — from the SDK's materialized view of the node. Throws EndpointNotFoundError
     * when the endpoint is unknown or its node is not currently mapped.
     *
     * It does not contact the device. It reads the SDK's cache, which the SDK's subscriptions
     * keep current while the node is online and which holds last-known values while it is
     * offline, so it answers even for an unreachable node — which is what lets a client render an
     * offline device greyed out instead of making it vanish.
     *
     * Synchronous, and permanently so: every value comes from that in-memory cache, and a live
     * read is neither needed while online nor possible while offline. Contrast `read` and
     * `invoke`, which do reach the device.
     *
     * Whether the caller is the commissioning use-case, assembling the `endpoint:added` payload,
     * or the registry receiving that event, is a wiring decision made where registry and matter
     * meet; this signature serves both.
     */
    describe(id: EndpointId): EndpointShape;
}
