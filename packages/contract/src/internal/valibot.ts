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
