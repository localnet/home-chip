import type { EndpointGateway, EndpointRepository, EndpointView } from "@home-chip/contract/endpoint/ports.ts";
import type { Logger } from "@home-chip/contract/logger/ports.ts";
import type { NodeGateway, NodeRepository, NodeView } from "@home-chip/contract/node/ports.ts";
import type { RoomRepository, RoomView } from "@home-chip/contract/room/ports.ts";

import { ComposedEndpointView } from "./views/endpoint.ts";
import { ComposedNodeView } from "./views/node.ts";
import { ComposedRoomView } from "./views/room.ts";

/**
 * The read model of the home: the three Views the server reads to answer `list` and `get` and to
 * compose the snapshot. Each composes its state on demand from the database — identity, names,
 * room assignment — and the matter adapter — reachability, device shape — holding nothing, so the
 * read model cannot drift from its sources and has nothing to hydrate or tear down.
 *
 * Not a Lifecycle, for the same reason: with no state to build at start or release at stop, this
 * is wiring rather than a component. It takes no event bus either, maintaining no state that
 * events would update — pushing live changes to clients is the server's business.
 */
export interface Registry {
    readonly node: NodeView;
    readonly endpoint: EndpointView;
    readonly room: RoomView;
}

/** What the Views compose from: logging, the three repositories and the two matter gateways. */
export interface RegistryDeps {
    readonly logger: Logger;
    readonly nodeRepository: NodeRepository;
    readonly endpointRepository: EndpointRepository;
    readonly roomRepository: RoomRepository;
    readonly nodeGateway: NodeGateway;
    readonly endpointGateway: EndpointGateway;
}

export function createRegistry(deps: RegistryDeps): Registry {
    // One "Registry" facility for the package, derived here and handed to the Views that log, so
    // a View never derives its own — the same arrangement as matter's gateways. Which View spoke
    // is carried by the message.
    const logger = deps.logger.get("Registry");

    return {
        node: new ComposedNodeView(deps.nodeRepository, deps.nodeGateway),
        endpoint: new ComposedEndpointView(logger, deps.endpointRepository, deps.endpointGateway),
        room: new ComposedRoomView(deps.roomRepository),
    };
}
