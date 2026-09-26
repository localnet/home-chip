import type { EndpointId } from "@home-chip/contract/common/ids.ts";
import type { EndpointGateway, EndpointRepository, EndpointView } from "@home-chip/contract/endpoint/ports.ts";
import type { EndpointRecord, EndpointShape, EndpointState } from "@home-chip/contract/endpoint/types.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";

/**
 * Composed on demand: the database-owned fields — name, roomId — from the repository, the
 * matter-owned structure from the gateway's `describe()`. Nothing is held here, so the view cannot
 * drift from either source.
 *
 * An endpoint whose node the matter adapter cannot resolve, the fabric and the database having
 * diverged, makes `describe()` throw. It is dropped from `list()` and answered as null from
 * `get()`, with a warning: one unresolvable endpoint must not fail a whole list or snapshot. The
 * policy lives here rather than in the gateway, which keeps `describe()` free to report that it
 * cannot resolve to callers who need to hear it.
 */
export class ComposedEndpointView implements EndpointView {
    readonly #logger: Logger;
    readonly #endpointRepository: EndpointRepository;
    readonly #endpointGateway: EndpointGateway;

    constructor(logger: Logger, endpointRepository: EndpointRepository, endpointGateway: EndpointGateway) {
        this.#logger = logger;
        this.#endpointRepository = endpointRepository;
        this.#endpointGateway = endpointGateway;
    }

    list(): EndpointState[] {
        const states: EndpointState[] = [];
        for (const record of this.#endpointRepository.findAll()) {
            const state = this.#compose(record);
            if (state !== null) {
                states.push(state);
            }
        }
        return states;
    }

    get(id: EndpointId): EndpointState | null {
        const record = this.#endpointRepository.findById(id);
        return record === null ? null : this.#compose(record);
    }

    #compose(record: EndpointRecord): EndpointState | null {
        let shape: EndpointShape;
        try {
            shape = this.#endpointGateway.describe(record.id);
        } catch (error) {
            this.#logger.warn("skipped unresolvable endpoint", record.id, error);
            return null;
        }
        return {
            id: record.id,
            nodeId: record.nodeId,
            deviceType: shape.deviceType,
            name: record.name,
            roomId: record.roomId,
            clusters: shape.clusters,
        };
    }
}
