import { IntegrationError, NotFoundError, UnreachableError } from "../common/errors.ts";
import type { EndpointId } from "../common/ids.ts";

/**
 * A Matter identifier as the specification writes it, and as the SDK's own diagnostics do:
 * hexadecimal with an `0x` prefix. A cluster reads as 0x0201 everywhere Matter is documented, so
 * a message saying 513 leaves the reader converting before they can recognise it.
 *
 * Messages only. `data` carries the numbers, which is what a client switches on.
 */
const hex = (id: number): string => `0x${id.toString(16)}`;

/**
 * The requested endpoint does not exist in the registry. Inherits the `NOT_FOUND_ERROR` code:
 * clients tell "not found" cases apart by the method they called and by `data.id`.
 *
 * Distinct from an endpoint whose parent node is unreachable — that is reported through
 * `NodeState.reachable`, not as an error.
 */
export class EndpointNotFoundError extends NotFoundError {
    constructor(id: EndpointId) {
        super(`Endpoint ${id} not found`, { data: { id } });
    }
}

/**
 * The endpoint does not serve that (cluster, attribute) pair. Raised by `endpoint.read` and by
 * `endpoint.write`. A `NotFoundError` rather than a `ValidationError`: the input is well formed
 * and only the addressed resource is missing. `data` carries the whole lookup so the client can
 * be precise.
 */
export class AttributeNotFoundError extends NotFoundError {
    constructor(endpointId: EndpointId, clusterId: number, attributeId: number) {
        super(`Attribute ${hex(attributeId)} on cluster ${hex(clusterId)} of endpoint ${endpointId} not found`, {
            data: { endpointId, clusterId, attributeId },
        });
    }
}

/**
 * The command is not in the device's AcceptedCommandList for that cluster, so it does not exist
 * on this cluster of this device. Raised by `endpoint.invoke` before the device is contacted,
 * since we hold that list; the equivalent for an attribute is only known from the device's own
 * answer. That difference is our mechanics, not something the client acts on — which is why both
 * cases are the same `NotFoundError` and leave the client the same move: correct the id.
 */
export class CommandNotFoundError extends NotFoundError {
    constructor(endpointId: EndpointId, clusterId: number, commandId: number) {
        super(`Command ${hex(commandId)} on cluster ${hex(clusterId)} of endpoint ${endpointId} not found`, {
            data: { endpointId, clusterId, commandId },
        });
    }
}

/**
 * The device received the command and answered with a non-success Matter Interaction Model
 * status: it rejected the command at runtime. `data.statusCode` carries that IM status so a
 * client can show which one. Distinct from never reaching the device (`UnreachableError`) and
 * from being refused locally (`CommandNotFoundError`).
 */
export class CommandRejectedError extends IntegrationError {
    constructor(endpointId: EndpointId, clusterId: number, commandId: number, statusCode: number) {
        super(`Command ${hex(commandId)} on cluster ${hex(clusterId)} of endpoint ${endpointId} was rejected`, {
            data: { endpointId, clusterId, commandId, statusCode },
        });
    }
}

/**
 * The device received the write and answered with a non-success Matter Interaction Model status.
 * `data.statusCode` carries that IM status, which is also how a client learns that it aimed at a
 * read-only attribute: the device answers UNSUPPORTED_WRITE (0x88) rather than failing in any
 * distinctive way. Distinct from never reaching the device (`UnreachableError`) and from the
 * attribute not existing at all (`AttributeNotFoundError`).
 */
export class WriteRejectedError extends IntegrationError {
    constructor(endpointId: EndpointId, clusterId: number, attributeId: number, statusCode: number) {
        super(
            `Write of attribute ${hex(attributeId)} on cluster ${hex(clusterId)} of endpoint ${endpointId} was rejected`,
            {
                data: { endpointId, clusterId, attributeId, statusCode },
            },
        );
    }
}

/**
 * A read, a write or an invoke failed inside the Matter interaction itself, for a reason none of
 * the classified cases covers: the request could not be encoded, an SDK precondition was not met,
 * or the exchange broke on a teardown or reconnect race.
 *
 * It names the interaction layer, not the operation, which is why one class serves all three:
 * everything specific to any of them is classified before it — an unserved attribute, an
 * unaccepted or rejected command, a rejected write, an unreachable device. It asserts nothing
 * beyond that; the SDK's own error is preserved in `cause`.
 */
export class InteractionFailedError extends IntegrationError {
    constructor(endpointId: EndpointId, clusterId: number, cause: unknown) {
        super(`The Matter interaction on cluster ${hex(clusterId)} of endpoint ${endpointId} failed`, {
            cause,
            data: { endpointId, clusterId },
        });
    }
}

/**
 * The target is a LIT (Long Idle Time) ICD — typically battery-powered — that was asleep, and the
 * request could not reach it within the window the SDK holds it for. A LIT peer sleeps most of
 * the time and is reachable only during the active window after its own Check-In.
 *
 * Unreachable, not rejected: the request never arrived, and it is retryable when the device next
 * wakes. Device-level, not tied to the attribute or command attempted — and if a write or an
 * invoke is delivered later, the resulting state still arrives through `endpoint:changed`.
 */
export class EndpointAsleepError extends UnreachableError {
    constructor(endpointId: EndpointId, clusterId: number, cause: unknown) {
        super(`Endpoint ${endpointId} cluster ${hex(clusterId)} could not be reached: the device is asleep`, {
            cause,
            data: { endpointId, clusterId },
        });
    }
}

/**
 * The device did not answer — the SDK exhausted its retransmissions — or the peer connection
 * failed transiently: an offline or dropped device. Unreachable, not rejected: the request never
 * arrived, and it is retryable once the device is back on the network. Device-level, not tied to
 * the attribute or command attempted.
 */
export class EndpointOfflineError extends UnreachableError {
    constructor(endpointId: EndpointId, clusterId: number, cause: unknown) {
        super(`Endpoint ${endpointId} cluster ${hex(clusterId)} could not be reached: the device is offline`, {
            cause,
            data: { endpointId, clusterId },
        });
    }
}
