import { randomUUIDv7 } from "node:crypto";

/**
 * Branding prevents passing a `RoomId` where a `NodeId` is expected, even though both are
 * strings at runtime. The property exists only in the type system and costs nothing.
 */
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/**
 * A Matter node: a physical, commissioned device on the fabric, and the unit of
 * commissioning, persistence and reachability. It maps to a Matter Node ID (uint64)
 * internally, but callers only ever see our own identifier.
 */
export type NodeId = Brand<string, "NodeId">;

/**
 * A Matter endpoint: a functional unit within a node, and what the user perceives as a
 * "device" — a light, a switch, a thermostat. A node may host many, each with its own
 * device type, clusters, name and room assignment.
 */
export type EndpointId = Brand<string, "EndpointId">;

/** A room: a user-defined grouping of endpoints, ours alone — Matter has no counterpart. */
export type RoomId = Brand<string, "RoomId">;

/**
 * UUID v7 embeds a millisecond timestamp in its leading bits, so identifiers sort by
 * creation time: rows insert in roughly chronological order, which keeps the database
 * indexes compact and improves locality compared with the fully random v4.
 */
export const createNodeId = (): NodeId => randomUUIDv7() as NodeId;
export const createEndpointId = (): EndpointId => randomUUIDv7() as EndpointId;
export const createRoomId = (): RoomId => randomUUIDv7() as RoomId;

/**
 * Checks the format, and only the format the factories above mint: version nibble 7, variant
 * nibble 8/9/a/b. Any other version is either a bug or a hand-crafted input, and rejecting it
 * surfaces that at the boundary. Whether the identifier belongs to an existing entity is the
 * repositories' question.
 *
 * A single predicate serves the three types because at runtime they are indistinguishable —
 * all three are UUIDs, and the distinction lives in the type system and in the database's
 * foreign keys. `internal/valibot.ts` supplies the branded type at the inference boundary.
 */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuidV7 = (value: unknown): boolean => typeof value === "string" && UUID_V7_PATTERN.test(value);
