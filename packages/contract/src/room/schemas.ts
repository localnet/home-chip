import * as v from "valibot";

import { parseOrThrow, roomIdSchema } from "../internal/valibot.ts";

/**
 * Validators for the room-namespace JSON-RPC methods. Each one parses its input and returns the
 * typed value, or throws ValidationError with structured issues, which the server translates into
 * JSON-RPC -32602 ("Invalid params").
 *
 * The Valibot schemas stay private. Names are unprefixed, so a caller importing several
 * subdomains differentiates by namespace import:
 *
 *     import * as roomSchemas from "@home-chip/contract/room/schemas.ts";
 *     roomSchemas.validateGetParams(input);
 */

// ---------------------------------------------------------------------------
// Shared building blocks

/**
 * The [1, 64] bounds are the ones endpoint names use, and match what Apple Home and SmartThings
 * allow: long enough to be descriptive, short enough to fit a UI without truncation. No charset
 * restriction — Unicode and emoji are allowed — and no uniqueness check, since two rooms may
 * legitimately share a name.
 */
const roomNameSchema = v.pipe(
    v.string(),
    v.minLength(1, "name must not be empty"),
    v.maxLength(64, "name must be at most 64 characters"),
);

// ---------------------------------------------------------------------------
// room.list

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
// room.get

const getParamsSchema = v.object({ id: roomIdSchema });

type GetParams = v.InferOutput<typeof getParamsSchema>;

export const validateGetParams = (input: unknown): GetParams => parseOrThrow(getParamsSchema, input);

// ---------------------------------------------------------------------------
// room.add

/** The client supplies only the name; the server mints the id and returns it. */
const addParamsSchema = v.object({ name: roomNameSchema });

type AddParams = v.InferOutput<typeof addParamsSchema>;

export const validateAddParams = (input: unknown): AddParams => parseOrThrow(addParamsSchema, input);

// ---------------------------------------------------------------------------
// room.setName

const setNameParamsSchema = v.object({
    id: roomIdSchema,
    name: roomNameSchema,
});

type SetNameParams = v.InferOutput<typeof setNameParamsSchema>;

export const validateSetNameParams = (input: unknown): SetNameParams => parseOrThrow(setNameParamsSchema, input);

// ---------------------------------------------------------------------------
// room.remove

const removeParamsSchema = v.object({ id: roomIdSchema });

type RemoveParams = v.InferOutput<typeof removeParamsSchema>;

export const validateRemoveParams = (input: unknown): RemoveParams => parseOrThrow(removeParamsSchema, input);
