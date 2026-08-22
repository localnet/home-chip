/**
 * A seedable in-memory view for tests: structurally a NodeView / EndpointView / RoomView
 * (list + get), plus a seed to populate it. Each handler group is injected the specific
 * view(s) it reads, so tests create one per entity rather than a registry bundle.
 */
export class TestView<Id, State extends { readonly id: Id }> {
    readonly #states = new Map<Id, State>();

    seed(state: State): void {
        this.#states.set(state.id, state);
    }

    list(): State[] {
        return [...this.#states.values()];
    }

    get(id: Id): State | null {
        return this.#states.get(id) ?? null;
    }
}
