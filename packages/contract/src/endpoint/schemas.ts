import * as v from "valibot";

import { endpointIdSchema, parseOrThrow, roomIdSchema } from "../internal/valibot.ts";
import type { AttributeValue } from "./types.ts";

/**
 * Validators for the endpoint-namespace JSON-RPC methods. Each one parses its input and returns
 * the typed value, or throws ValidationError with structured issues, which the server translates
 * into JSON-RPC -32602 ("Invalid params").
 *
 * The Valibot schemas stay private. Names are unprefixed, so a caller importing several
 * subdomains differentiates by namespace import:
 *
 *     import * as endpointSchemas from "@home-chip/contract/endpoint/schemas.ts";
 *     endpointSchemas.validateGetParams(input);
 *
 * These schemas check shape only. Whether a cluster, attribute or command exists on the device,
 * and whether a room exists, is settled downstream by the matter adapter and the handlers.
 */

// ---------------------------------------------------------------------------
// Shared building blocks

/**
 * The inbound counterpart of `AttributeValue`, resolved through `v.lazy` so it can refer to
 * itself. It omits `bigint`: JSON cannot carry one, so nothing arriving over the wire can be one.
 * The declared output type is the wider `AttributeValue`, of which this union is a subset —
 * decoding a 64-bit field of an inbound command will be added per command, by cluster and command
 * identity, when a supported device first takes one.
 */
const attributeValueSchema: v.GenericSchema<unknown, AttributeValue> = v.lazy(() =>
    v.union([
        v.string(),
        v.number(),
        v.boolean(),
        v.null(),
        v.array(attributeValueSchema),
        v.record(v.string(), attributeValueSchema),
    ]),
);

/**
 * Root schema for command arguments. A command's argument struct is never null: "no arguments" is
 * expressed by omitting `args`, not by passing null. So the root forbids null while still
 * allowing it nested — a nullable command field such as
 * ValveConfigurationAndControl.Open.OpenDuration arrives as `{ field: null }`, with the null
 * inside the struct rather than as the struct.
 */
const invokeArgsSchema = v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.array(attributeValueSchema),
    v.record(v.string(), attributeValueSchema),
]);

/**
 * Matter cluster, attribute and command identifiers. They are 32-bit values whose upper 16 bits
 * carry the Manufacturer Extensible Identifier prefix — 0x0000 for the standard elements, a
 * vendor id for manufacturer-specific ones — so the range covers both. The top value 0xffffffff
 * is the wildcard in a Matter path and is not a valid target here.
 *
 * This is the shape of an identifier, not the set of addressable ones. Matter narrows that set
 * differently for each kind of element, and a manufacturer cluster is legal where an attribute
 * with the same suffix is not. Restating those rules here would be one schema per kind,
 * duplicating a part of the Matter model that moves with its revisions — and getting one wrong
 * refuses a legitimate device. The model lives in the SDK, so the matter adapter is what settles
 * addressability, and what it refuses comes back as invalid params.
 */
const matterIdSchema = v.pipe(
    v.number(),
    v.integer("must be an integer"),
    v.minValue(0x00000000, "must be at least 0x00000000"),
    v.maxValue(0xfffffffe, "must be at most 0xfffffffe"),
);

// ---------------------------------------------------------------------------
// endpoint.list

/**
 * Takes no parameters, so it accepts `undefined` or an object. Unknown members are ignored rather
 * than rejected, as in every params schema here: strictness in this contract is reserved for the
 * envelope, where discriminating the union depends on it. Rejecting positional params is the
 * envelope's job too — no object schema distinguishes an array on its own.
 */
const listParamsSchema = v.optional(v.object({}));

type ListParams = v.InferOutput<typeof listParamsSchema>;

export const validateListParams = (input: unknown): ListParams => parseOrThrow(listParamsSchema, input);

// ---------------------------------------------------------------------------
// endpoint.get

const getParamsSchema = v.object({ id: endpointIdSchema });

type GetParams = v.InferOutput<typeof getParamsSchema>;

export const validateGetParams = (input: unknown): GetParams => parseOrThrow(getParamsSchema, input);

// ---------------------------------------------------------------------------
// endpoint.read

/**
 * The triple (endpointId, clusterId, attributeId) identifies what to read. A combination the
 * device does not serve surfaces later as `AttributeNotFoundError` from the matter adapter.
 */
const readParamsSchema = v.object({
    id: endpointIdSchema,
    clusterId: matterIdSchema,
    attributeId: matterIdSchema,
});

type ReadParams = v.InferOutput<typeof readParamsSchema>;

export const validateReadParams = (input: unknown): ReadParams => parseOrThrow(readParamsSchema, input);

// ---------------------------------------------------------------------------
// endpoint.write

/**
 * Writes one attribute. `value` is validated as an `AttributeValue` and null is accepted at the
 * root, unlike `invoke`'s `args`: many attributes are declared nullable by the spec, and writing
 * null to one of them is the legitimate way to clear it. Whether the attribute exists, is
 * writable and accepts this value is settled by the device, which answers with an Interaction
 * Model status.
 */
const writeParamsSchema = v.object({
    id: endpointIdSchema,
    clusterId: matterIdSchema,
    attributeId: matterIdSchema,
    value: attributeValueSchema,
});

type WriteParams = v.InferOutput<typeof writeParamsSchema>;

export const validateWriteParams = (input: unknown): WriteParams => parseOrThrow(writeParamsSchema, input);

// ---------------------------------------------------------------------------
// endpoint.invoke

/**
 * `args` is optional: omit it for commands that take no fields, otherwise pass the field struct.
 * Per-command field validation happens downstream, against the device's accepted command schema.
 */
const invokeParamsSchema = v.object({
    id: endpointIdSchema,
    clusterId: matterIdSchema,
    commandId: matterIdSchema,
    args: v.optional(invokeArgsSchema),
});

type InvokeParams = v.InferOutput<typeof invokeParamsSchema>;

export const validateInvokeParams = (input: unknown): InvokeParams => parseOrThrow(invokeParamsSchema, input);

// ---------------------------------------------------------------------------
// endpoint.setName

/**
 * The [1, 64] bounds match what Apple Home and SmartThings allow for accessory names: long enough
 * to be descriptive, short enough to fit a UI without truncation. No charset restriction —
 * Unicode and emoji are allowed, and presentation-level normalization is the frontend's business.
 */
const setNameParamsSchema = v.object({
    id: endpointIdSchema,
    name: v.pipe(
        v.string(),
        v.minLength(1, "name must not be empty"),
        v.maxLength(64, "name must be at most 64 characters"),
    ),
});

type SetNameParams = v.InferOutput<typeof setNameParamsSchema>;

export const validateSetNameParams = (input: unknown): SetNameParams => parseOrThrow(setNameParamsSchema, input);

// ---------------------------------------------------------------------------
// endpoint.setRoom

/** Assigns the endpoint to a room, or clears the assignment when `roomId` is `null`. */
const setRoomParamsSchema = v.object({
    id: endpointIdSchema,
    roomId: v.nullable(roomIdSchema),
});

type SetRoomParams = v.InferOutput<typeof setRoomParamsSchema>;

export const validateSetRoomParams = (input: unknown): SetRoomParams => parseOrThrow(setRoomParamsSchema, input);
