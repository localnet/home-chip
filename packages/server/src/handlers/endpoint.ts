import type { EndpointView } from "@home-chip/contract/endpoint/ports.ts";
import {
    validateGetParams,
    validateInvokeParams,
    validateListParams,
    validateReadParams,
    validateSetNameParams,
    validateSetRoomParams,
    validateWriteParams,
} from "@home-chip/contract/endpoint/schemas.ts";

import type { HandlerTable } from "../dispatcher.ts";
import type { EndpointUseCase } from "../use-cases/endpoint.ts";

export interface EndpointHandlerDeps {
    readonly endpointView: EndpointView;
    readonly endpointUseCase: EndpointUseCase;
}

export function endpointHandlers(deps: EndpointHandlerDeps): HandlerTable {
    return {
        "endpoint.list": (params) => {
            validateListParams(params);
            return deps.endpointView.list();
        },
        "endpoint.get": (params) => {
            const { id } = validateGetParams(params);
            return deps.endpointView.get(id);
        },
        "endpoint.read": (params) => {
            const { id, clusterId, attributeId } = validateReadParams(params);
            return deps.endpointUseCase.read(id, clusterId, attributeId);
        },
        "endpoint.write": (params) => {
            const { id, clusterId, attributeId, value } = validateWriteParams(params);
            return deps.endpointUseCase.write(id, clusterId, attributeId, value);
        },
        "endpoint.invoke": (params) => {
            const { id, clusterId, commandId, args } = validateInvokeParams(params);
            return deps.endpointUseCase.invoke(id, clusterId, commandId, args);
        },
        "endpoint.setName": (params) => {
            const { id, name } = validateSetNameParams(params);
            return deps.endpointUseCase.rename(id, name);
        },
        "endpoint.setRoom": (params) => {
            const { id, roomId } = validateSetRoomParams(params);
            return deps.endpointUseCase.assignRoom(id, roomId);
        },
    };
}
