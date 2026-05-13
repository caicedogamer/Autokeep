/*
 * Typed pub/sub event bus.
 *
 * The `Events` interface below is the single, central declaration of
 * every cross-module event in the app. Modules contribute their event
 * variants via TypeScript's interface-merging from inside their own
 * declaration files (e.g. `src/modules/records/events.ts` declaring
 * `interface Events { 'records:changed': { ids: Id[] } }`).
 *
 * This keeps the bus type-safe (`emit('records:changed', payload)` is
 * checked against the declared payload type) without requiring a central
 * file to know about every module — Constitution Principle I.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Events {
  // Modules contribute keys via interface merging. Empty by design.
}

export type EventName = keyof Events;
export type EventHandler<K extends EventName> = (payload: Events[K]) => void;

export interface EventBus {
  on<K extends EventName>(event: K, handler: EventHandler<K>): () => void;
  off<K extends EventName>(event: K, handler: EventHandler<K>): void;
  emit<K extends EventName>(event: K, payload: Events[K]): void;
  /** For tests / hot-reload only. Removes all handlers for all events. */
  clearAll(): void;
}

export const createBus = (): EventBus => {
  // The handler set is intentionally untyped at storage time; callers are
  // type-checked at the `on`/`emit` boundary.
  const handlers = new Map<EventName, Set<(payload: unknown) => void>>();

  const on: EventBus['on'] = (event, handler) => {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => {
      set?.delete(handler as (payload: unknown) => void);
    };
  };

  const off: EventBus['off'] = (event, handler) => {
    handlers.get(event)?.delete(handler as (payload: unknown) => void);
  };

  const emit: EventBus['emit'] = (event, payload) => {
    const set = handlers.get(event);
    if (!set) return;
    // Snapshot so handlers that mutate the set during dispatch don't break iteration.
    for (const handler of [...set]) {
      handler(payload);
    }
  };

  const clearAll: EventBus['clearAll'] = () => {
    handlers.clear();
  };

  return { on, off, emit, clearAll };
};

/**
 * App-wide bus singleton. Tests should prefer `createBus()` and inject
 * the result, not import this. Composition root (src/main.ts) wires
 * module services to this instance.
 */
export const appBus: EventBus = createBus();
