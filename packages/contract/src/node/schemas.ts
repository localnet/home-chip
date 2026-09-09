import * as v from "valibot";

import { nodeIdSchema, parseOrThrow } from "../internal/valibot.ts";

/**
 * Validators for the node-namespace JSON-RPC methods. Each one parses its input and returns the
 * typed value, or throws ValidationError with structured issues, which the server translates into
 * JSON-RPC -32602 ("Invalid params").
 *
 * The Valibot schemas stay private. Names are unprefixed, so a caller importing several
 * subdomains differentiates by namespace import:
 *
 *     import * as nodeSchemas from "@home-chip/contract/node/schemas.ts";
 *     nodeSchemas.validateGetParams(input);
 */

// ---------------------------------------------------------------------------
// node.list

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
// node.get

const getParamsSchema = v.object({ id: nodeIdSchema });

type GetParams = v.InferOutput<typeof getParamsSchema>;

export const validateGetParams = (input: unknown): GetParams => parseOrThrow(getParamsSchema, input);

// ---------------------------------------------------------------------------
// node.getInfo

const getInfoParamsSchema = v.object({ id: nodeIdSchema });

type GetInfoParams = v.InferOutput<typeof getInfoParamsSchema>;

export const validateGetInfoParams = (input: unknown): GetInfoParams => parseOrThrow(getInfoParamsSchema, input);

// ---------------------------------------------------------------------------
// node.commission

/**
 * What the device's owner reads off it, in either of the two forms the spec defines: the digits of
 * the manual pairing code, or the "MT:" payload behind the QR code. Only the shape is checked here
 * — the checksum, the Base38 decoding and the handshake belong to the SDK, and a failure there
 * surfaces as `CommissioningFailedError` with the specific SDK error in `cause`.
 *
 * A manual code is 11 digits, or 21 when it carries the vendor and product ids that a
 * non-standard commissioning flow requires — a device whose pairing goes through a manufacturer
 * app. Both lengths are what `ManualPairingCodeCodec` decodes, and the gateway hands the code to
 * it untouched, so accepting only the shorter one turned every such device into a malformed code.
 *
 * The two QR bounds are that codec's, and they measure different things. Each `*`-separated
 * payload carries at most 255 Base38 characters, the "MT:" prefix not among them; the whole
 * string, prefix included, at most 4296. Hence the repetition below rather than one length check
 * over the lot.
 *
 * `*` is a separator and not a payload character, which is why it sits between the repeats instead
 * of in the class: a code that is nothing but separators is malformed, while a well-formed one
 * naming several devices is admitted on purpose. The matter adapter answers that with a
 * `SetupCodeAmbiguousError` telling the client which code to split — a better answer than refusing
 * to read it here.
 */
const MANUAL_CODE_PATTERN = /^(?:\d{11}|\d{21})$/;

const QR_PAYLOAD_PATTERN = /^MT:[0-9A-Z.-]{1,255}(?:\*[0-9A-Z.-]{1,255})*$/;

const setupCodeSchema = v.union(
    [
        v.pipe(v.string(), v.regex(MANUAL_CODE_PATTERN)),
        v.pipe(v.string(), v.regex(QR_PAYLOAD_PATTERN), v.maxLength(4296)),
    ],
    "setupCode must be a manual pairing code of 11 or 21 digits, or an MT: QR payload",
);

const commissionParamsSchema = v.object({ setupCode: setupCodeSchema });

type CommissionParams = v.InferOutput<typeof commissionParamsSchema>;

export const validateCommissionParams = (input: unknown): CommissionParams =>
    parseOrThrow(commissionParamsSchema, input);

// ---------------------------------------------------------------------------
// node.decommission

/**
 * `force` drops the node locally without removing our fabric from the device, which is how a
 * device that is gone for good — broken, lost, already factory-reset — can still be removed. It
 * defaults to false so the normal path always attempts the proper fabric removal first.
 */
const decommissionParamsSchema = v.object({
    id: nodeIdSchema,
    force: v.optional(v.boolean(), false),
});

type DecommissionParams = v.InferOutput<typeof decommissionParamsSchema>;

export const validateDecommissionParams = (input: unknown): DecommissionParams =>
    parseOrThrow(decommissionParamsSchema, input);
