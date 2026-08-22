import type { RoomView } from "@home-chip/contract/room/ports.ts";
import {
    validateAddParams,
    validateGetParams,
    validateListParams,
    validateRemoveParams,
    validateSetNameParams,
} from "@home-chip/contract/room/schemas.ts";

import type { HandlerTable } from "../dispatcher.ts";
import type { RoomUseCase } from "../use-cases/room.ts";

export interface RoomHandlerDeps {
    readonly roomView: RoomView;
    readonly roomUseCase: RoomUseCase;
}

export function roomHandlers(deps: RoomHandlerDeps): HandlerTable {
    return {
        "room.list": (params) => {
            validateListParams(params);
            return deps.roomView.list();
        },
        "room.get": (params) => {
            const { id } = validateGetParams(params);
            return deps.roomView.get(id);
        },
        "room.add": (params) => {
            const { name } = validateAddParams(params);
            return deps.roomUseCase.create(name);
        },
        "room.setName": (params) => {
            const { id, name } = validateSetNameParams(params);
            return deps.roomUseCase.rename(id, name);
        },
        "room.remove": (params) => {
            const { id } = validateRemoveParams(params);
            return deps.roomUseCase.remove(id);
        },
    };
}
