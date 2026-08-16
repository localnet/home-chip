import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { createRoomId } from "../../src/common/ids.ts";
import { RoomNotFoundError } from "../../src/room/errors.ts";

describe("room/errors", () => {
    test("RoomNotFoundError carries the not-found code, the id and a message naming it", () => {
        const id = createRoomId();

        const error = new RoomNotFoundError(id);

        assert.equal(error.code, "NOT_FOUND_ERROR");
        assert.deepEqual(error.data, { id });
        assert.match(error.message, new RegExp(id));
    });
});
