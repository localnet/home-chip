import * as v from "valibot";

import { ValidationError } from "../common/errors.ts";
import { type EndpointId, isUuidV7, type NodeId, type RoomId } from "../common/ids.ts";

/**
 * Package-private Valibot infrastructure, shared by the subdomain `schemas.ts` files. It is
 * deliberately absent from the `exports` map: the package's public surface is the
 * `validate*Params` functions, so Valibot stays a swappable implementation detail that no
 * consumer can pin a version of.
 */

/**
 * Schemas for the branded identifiers. The runtime check is the format guard from
 * `common/ids.ts`; the brand comes from the type argument, so a parsed value arrives branded
 * with no cast at the call site.
 *
 * The message names no field, unlike the rest of the contract's, because one schema serves every
 * identifier field there is. The failing field reaches the client in the issue's path either way:
 *
 *     const params = v.object({ id: nodeIdSchema, seconds: ... });
 *     type Params = v.InferOutput<typeof params>;  // { id: NodeId; seconds: number }
 */
export const nodeIdSchema = v.custom<NodeId>(isUuidV7, "must be a UUID v7");
export const endpointIdSchema = v.custom<EndpointId>(isUuidV7, "must be a UUID v7");
export const roomIdSchema = v.custom<RoomId>(isUuidV7, "must be a UUID v7");

/**
 * The name a user gives an endpoint or a room. One schema for both because it is one kind of
 * field: the same text, typed into the same kind of box. `endpoints.name` in particular has to
 * mean the same thing whether a client wrote it or the matter adapter derived it from the device,
 * so the rule lives here rather than once per subdomain.
 *
 * It is composed to NFC first, which makes it the only schema in the package that changes what it
 * was given. "é" typed as one character and "é" typed as e-plus-accent are canonically equivalent
 * — the same text, spelled two ways in bytes — so left alone the second costs twice the first and
 * which of two identical-looking names fits would turn on the user's keyboard.
 *
 * The 64 counts code points rather than the UTF-16 units `.length` returns. Those two agree for
 * anything in the BMP and part company above it, where `.length` counts double: emoji, but also
 * the CJK extension blocks that carry real surnames, and the mathematical alphabets people paste
 * in to make a name look decorative. Counting code points is right because it counts characters,
 * not because most text happens to sit in the BMP.
 *
 * Emoji are refused, and that is a product decision rather than a technical one — code points
 * already count them correctly, so nothing here needs them gone. The pattern covers the three
 * ways one can be spelled: a pictograph, the pair of regional indicators that makes a flag, and
 * the variation selector or keycap combiner that turn an ordinary character into one. It is
 * deliberately not Apple's rule for HomeKit names, which also refuses hyphens and anything shorter
 * than two characters, and which exists so that Siri can hear a name — a problem we do not have.
 *
 * U+001F is refused because Matter reserves it within a character string and the SDK truncates a
 * string there on decode, without saying so. A name carrying one would arrive already cut.
 */
const NAME_MAX_CODE_POINTS = 64;

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u20E3/u;

const INFORMATION_SEPARATOR_1 = "\u001f";

export const nameSchema = v.pipe(
    v.string(),
    v.transform((name) => name.normalize("NFC")),
    v.minLength(1, "name must not be empty"),
    v.check(
        (name) => [...name].length <= NAME_MAX_CODE_POINTS,
        `name must be at most ${NAME_MAX_CODE_POINTS} characters`,
    ),
    v.check((name) => !EMOJI.test(name), "name must not contain emoji"),
    v.check((name) => !name.includes(INFORMATION_SEPARATOR_1), "name must not contain U+001F"),
);

/**
 * Parses `input` against `schema`, or throws `ValidationError` carrying every issue found in
 * `data.issues`, each with its path in the conventional dotted form (e.g. "user.address.street").
 * Every subdomain validator goes through here, so a failure has the same shape whichever method
 * the client called.
 */
export function parseOrThrow<TSchema extends v.GenericSchema>(schema: TSchema, input: unknown): v.InferOutput<TSchema> {
    const result = v.safeParse(schema, input);
    if (result.success) {
        return result.output;
    }
    throw new ValidationError("Invalid params", {
        data: {
            issues: result.issues.map((issue) => ({
                path: v.getDotPath(issue),
                message: issue.message,
            })),
        },
    });
}
