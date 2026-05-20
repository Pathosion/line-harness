import type { UpdateEvent } from './types.js';

/**
 * Event emitter used by the update engine to broadcast progress events
 * across phases (preflight, migration, worker, admin, liff, verify,
 * rollback, complete).
 *
 * Two delivery channels:
 *   1. **Subscribers** — in-process listeners (e.g. CLI progress bar,
 *      admin SSE stream). Called synchronously when `emit` is invoked so
 *      UIs feel responsive even if persist is slow.
 *   2. **persist callback** — fired once per event and awaited before
 *      `emit` resolves. Callers use this to append to D1
 *      `update_events` so the timeline survives a crash mid-update.
 *
 * If `persist` throws, the error propagates out of `emit` — the caller
 * decides whether to abort the update or swallow the error. v1 doesn't
 * retry persist failures internally.
 */
export interface EventEmitter {
  /**
   * Broadcast an event to all current subscribers (synchronously, in
   * insertion order) and then await `persist(e)`.
   */
  emit(e: UpdateEvent): Promise<void>;

  /**
   * Register a listener. Returns an unsubscribe function. Calling the
   * unsubscribe function more than once is a no-op.
   */
  subscribe(handler: (e: UpdateEvent) => void): () => void;
}

export function createEventEmitter(opts: {
  persist: (e: UpdateEvent) => Promise<void>;
}): EventEmitter {
  // Use a Set so handlers are unique and unsubscribe is O(1). Iteration
  // order is insertion order (per ECMAScript spec) which keeps subscriber
  // notification deterministic.
  const handlers = new Set<(e: UpdateEvent) => void>();

  return {
    async emit(e: UpdateEvent): Promise<void> {
      // Snapshot the handler set so a subscriber that unsubscribes during
      // delivery doesn't perturb iteration. Subscriber exceptions are
      // intentionally not caught here — a misbehaving subscriber should
      // surface loudly rather than silently break the timeline.
      for (const h of Array.from(handlers)) {
        h(e);
      }
      await opts.persist(e);
    },

    subscribe(handler: (e: UpdateEvent) => void): () => void {
      handlers.add(handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        handlers.delete(handler);
      };
    },
  };
}
