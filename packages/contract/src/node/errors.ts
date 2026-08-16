import { ConflictError, IntegrationError, NotFoundError, UnreachableError, ValidationError } from "../common/errors.ts";
import type { NodeId } from "../common/ids.ts";

/**
 * The requested node does not exist in the registry. Inherits the `NOT_FOUND_ERROR` code:
 * clients tell "not found" cases apart by the method they called and by `data.id`.
 *
 * Distinct from a node that exists but cannot be reached — that returns its state with
 * `reachable: false`, never an error.
 */
export class NodeNotFoundError extends NotFoundError {
    constructor(id: NodeId) {
        super(`Node ${id} not found`, { data: { id } });
    }
}

/**
 * Commissioning failed for a reason originating in the SDK or the device: the device was not
 * found on the network, the PASE handshake failed, the fabric configuration was rejected. The
 * original error chain is in `cause`. The SDK does not report which commissioning phase failed,
 * so none is fabricated here.
 */
export class CommissioningFailedError extends IntegrationError {
    constructor(cause: unknown) {
        super("Commissioning failed", { cause });
    }
}

/**
 * The setup code is a concatenated QR payload: a single well-formed code that names several
 * devices, as a box of three bulbs may carry. Commissioning pairs one device and nothing in the
 * code says which, so it is refused rather than paired with whichever answers first — the same
 * choice both reference controllers make.
 *
 * A `ValidationError` because the client can act on it: scan or type one device's code. It is
 * raised by the matter adapter rather than by the schema, since counting the payloads means
 * decoding Base38, which is the SDK's job and not a shape check.
 */
export class AmbiguousSetupCodeError extends ValidationError {
    constructor(deviceCount: number) {
        super(`Setup code carries ${deviceCount} devices; provide the code of a single device`, {
            data: { deviceCount },
        });
    }
}

/**
 * The device already belongs to our fabric and so cannot be commissioned again. The device
 * itself reports it, answering the AddNOC step with a FabricConflict status.
 *
 * It carries no id of the existing node: commissioning aborted before we held one, and the
 * device's answer identifies nothing we could correlate with our records. The usual cause is a
 * device dropped with `decommission(force)`, which removes it locally but leaves our fabric on
 * the device, so recovering means factory-resetting it.
 */
export class DeviceAlreadyCommissionedError extends ConflictError {
    constructor() {
        super("Device is already commissioned into this fabric");
    }
}

/**
 * Decommissioning failed for a reason originating in the SDK or the device, other than the node
 * being unreachable: the fabric removal was rejected, the session broke in a way the SDK does not
 * treat as a clean close. The counterpart of `CommissioningFailedError`, and like it a catch-all: the
 * unreachable cases are classified first and never land here.
 */
export class DecommissioningFailedError extends IntegrationError {
    constructor(id: NodeId, cause: unknown) {
        super("Decommissioning failed", { cause, data: { id } });
    }
}

/**
 * The node is a LIT (Long Idle Time) ICD — typically battery-powered — that was asleep, and the
 * operation could not reach it within the window the SDK holds it for. The node-level counterpart
 * of `EndpointAsleepError`: the same condition, reached through an operation that addresses the
 * node as a whole rather than one of its endpoints.
 *
 * Retryable on a schedule: the node wakes on its own Check-In, so the same call is expected to
 * succeed later. That is what separates it from `NodeOfflineError`.
 */
export class NodeAsleepError extends UnreachableError {
    constructor(id: NodeId, cause: unknown) {
        super(`Node ${id} could not be reached: the device is asleep`, { cause, data: { id } });
    }
}

/**
 * The node did not answer — the SDK exhausted its retransmissions — or the peer connection failed
 * transiently: an offline, removed or dead device.
 *
 * The request never reached the device, as with `NodeAsleepError`, but here nothing guarantees
 * the device ever comes back, so retrying may never succeed. A device gone for good leaves its
 * node removable only by force.
 */
export class NodeOfflineError extends UnreachableError {
    constructor(id: NodeId, cause: unknown) {
        super(`Node ${id} could not be reached: the device is offline`, { cause, data: { id } });
    }
}
