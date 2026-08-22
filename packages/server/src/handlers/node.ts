import type { NodeView } from "@home-chip/contract/node/ports.ts";
import {
    validateCommissionParams,
    validateDecommissionParams,
    validateGetInfoParams,
    validateGetParams,
    validateListParams,
} from "@home-chip/contract/node/schemas.ts";

import type { HandlerTable } from "../dispatcher.ts";
import type { CommissionUseCase } from "../use-cases/commission.ts";
import type { DecommissionUseCase } from "../use-cases/decommission.ts";
import type { NodeUseCase } from "../use-cases/node.ts";

export interface NodeHandlerDeps {
    readonly nodeView: NodeView;
    readonly commissionUseCase: CommissionUseCase;
    readonly decommissionUseCase: DecommissionUseCase;
    readonly nodeUseCase: NodeUseCase;
}

export function nodeHandlers(deps: NodeHandlerDeps): HandlerTable {
    return {
        "node.list": (params) => {
            validateListParams(params);
            return deps.nodeView.list();
        },
        "node.get": (params) => {
            const { id } = validateGetParams(params);
            return deps.nodeView.get(id);
        },
        "node.getInfo": (params) => {
            const { id } = validateGetInfoParams(params);
            return deps.nodeUseCase.getInfo(id);
        },
        "node.commission": (params) => {
            const { setupCode } = validateCommissionParams(params);
            return deps.commissionUseCase.execute(setupCode);
        },
        "node.decommission": (params) => {
            const { id, force } = validateDecommissionParams(params);
            return deps.decommissionUseCase.execute(id, force);
        },
    };
}
