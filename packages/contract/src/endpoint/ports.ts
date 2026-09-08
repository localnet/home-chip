import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { AttributeValue, EndpointRecord, EndpointShape, EndpointState } from "./types.ts";

/**
 * Read-only access to the state of every endpoint, implemented by the registry. There are no
 * mutators because there is nothing here to mutate: each call composes its answer on the spot —
 * `name` and `roomId` from the endpoint repository, device type and clusters from the gateway's
 * `describe` — and holds nothing between calls, so the read model keeps no copy that could drift
 * from either source.
 *
 * The endpoint:* events are therefore not what keeps this current. They exist for a consumer that
 * does hold a copy — a connected client — and a caller on this side of the wire asks again rather
 * than tracking them: what these methods return is a point-in-time value, not a live reference.
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
     * Every endpoint of the given node, for rebuilding its identity at hydration — the one caller
     * there is. Decommissioning does not enumerate them: the cascade on endpoints.node_id takes
     * them with the node row.
     */
    findByNode(nodeId: NodeId): EndpointRecord[];

    /**
     * Inserts a new record. Called inside the commissioning transaction, after the node is saved.
     * No event follows it there: commissioning announces the node alone.
     */
    save(record: EndpointRecord): void;

    /** Updates the user-assigned name, leaving every other field alone. Throws if unknown. */
    setName(id: EndpointId, name: string): void;

    /** Assigns the room, or clears it with `null`. Throws if unknown. */
    setRoom(id: EndpointId, roomId: RoomId | null): void;

    /**
     * Removes one endpoint, for a dynamic removal from a Matter Bridge. Decommissioning a whole
     * node does not come through here at all: deleting the node row takes its endpoints with it
     * through the `ON DELETE CASCADE` on endpoints.node_id.
     *
     * Throws EndpointNotFoundError if the endpoint does not exist, as setName and setRoom do, so a
     * caller can emit `endpoint:removed` on the strength of this call alone rather than reading
     * first to find out whether anything was actually deleted.
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
     * The registry's endpoint view is the only caller, on every `list()` and `get()`. That is what
     * makes the read model read-through: nothing here is projected into a store that would then
     * have to be kept in step with the SDK's.
     */
    describe(id: EndpointId): EndpointShape;
}
