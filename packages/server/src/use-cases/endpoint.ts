import type { EndpointId, RoomId } from "@home-chip/contract/common/ids.ts";
import type { EndpointGateway, EndpointRepository } from "@home-chip/contract/endpoint/ports.ts";
import type { AttributeValue } from "@home-chip/contract/endpoint/types.ts";
import type { DomainEventBus } from "@home-chip/contract/events.ts";
import { RoomNotFoundError } from "@home-chip/contract/room/errors.ts";
import type { RoomRepository } from "@home-chip/contract/room/ports.ts";

/** Collaborators for endpoint operations: the two repositories, the bus, and the device gateway. */
export interface EndpointDeps {
    readonly endpointRepository: EndpointRepository;
    readonly roomRepository: RoomRepository;
    readonly endpointGateway: EndpointGateway;
    readonly bus: DomainEventBus;
}

/**
 * Everything the endpoint namespace does, in two groups.
 *
 * Metadata edits — rename, assignRoom — persist and then emit, synchronously: SQLite writes and
 * the bus dispatches inline, so there is nothing to await. The repository reports an id that
 * matches nothing before any event is emitted, so a failed write never produces a phantom one.
 *
 * Device operations — read, write, invoke — go straight through the gateway, touching neither the
 * database nor the bus. `write` and `invoke` are momentary: the resulting state comes back on its
 * own as `endpoint:changed` through the adapter's attribute watch, so neither returns it. Errors
 * from the device propagate unchanged.
 */
export class EndpointUseCase {
    readonly #endpointRepository: EndpointRepository;
    readonly #roomRepository: RoomRepository;
    readonly #endpointGateway: EndpointGateway;
    readonly #bus: DomainEventBus;

    constructor(deps: EndpointDeps) {
        this.#endpointRepository = deps.endpointRepository;
        this.#roomRepository = deps.roomRepository;
        this.#endpointGateway = deps.endpointGateway;
        this.#bus = deps.bus;
    }

    rename(id: EndpointId, name: string): void {
        this.#endpointRepository.setName(id, name);
        this.#bus.emit("endpoint:renamed", { endpointId: id, name, timestamp: Date.now() });
    }

    assignRoom(id: EndpointId, roomId: RoomId | null): void {
        // The room is checked here because the alternative is a foreign key violation: SQLite
        // would refuse the write with a constraint error, where the client needs a not-found
        // naming the room it asked for.
        //
        // Translating that error inside the repository would save this dependency, but SQLite
        // reports only "FOREIGN KEY constraint failed" with no column, so it can tell which key
        // failed only where a statement touches exactly one — setRoom does, save does not. That
        // is a property of each statement rather than of the table, so every future one would
        // have to be read against the rule, and a second key added to an existing statement would
        // make the translation lie rather than fail. There is nothing to gain the other way
        // either: this runs to completion without an await, so no request interleaves between the
        // read and the write.
        if (roomId !== null && this.#roomRepository.findById(roomId) === null) {
            throw new RoomNotFoundError(roomId);
        }
        this.#endpointRepository.setRoom(id, roomId);
        this.#bus.emit("endpoint:room-changed", { endpointId: id, roomId, timestamp: Date.now() });
    }

    async read(id: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue> {
        return this.#endpointGateway.read(id, clusterId, attributeId);
    }

    async write(id: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void> {
        await this.#endpointGateway.write(id, clusterId, attributeId, value);
    }

    async invoke(id: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void> {
        await this.#endpointGateway.invoke(id, clusterId, commandId, args);
    }
}
