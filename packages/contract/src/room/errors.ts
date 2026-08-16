import { NotFoundError } from "../common/errors.ts";
import type { RoomId } from "../common/ids.ts";

/**
 * The requested room does not exist. Inherits the `NOT_FOUND_ERROR` code: clients tell
 * "not found" cases apart by the method they called and by `data.id`.
 */
export class RoomNotFoundError extends NotFoundError {
    constructor(id: RoomId) {
        super(`Room ${id} not found`, { data: { id } });
    }
}
