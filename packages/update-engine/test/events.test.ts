import { describe, it, expect, vi } from 'vitest';
import { createEventEmitter } from '../src/events.js';
import type { UpdateEvent } from '../src/types.js';

const sampleEvent = (overrides: Partial<UpdateEvent> = {}): UpdateEvent => ({
  step: 'preflight',
  status: 'running',
  ...overrides,
});

describe('createEventEmitter', () => {
  it('delivers events to a subscriber', async () => {
    const persist = vi.fn(async () => {});
    const emitter = createEventEmitter({ persist });

    const handler = vi.fn();
    emitter.subscribe(handler);

    const event = sampleEvent();
    await emitter.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('calls persist callback for each event', async () => {
    const persist = vi.fn(async () => {});
    const emitter = createEventEmitter({ persist });

    const e1 = sampleEvent({ status: 'running' });
    const e2 = sampleEvent({ status: 'done' });

    await emitter.emit(e1);
    await emitter.emit(e2);

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenNthCalledWith(1, e1);
    expect(persist).toHaveBeenNthCalledWith(2, e2);
  });

  it('subscribe returns unsubscribe function that removes the handler', async () => {
    const persist = vi.fn(async () => {});
    const emitter = createEventEmitter({ persist });

    const handler = vi.fn();
    const unsubscribe = emitter.subscribe(handler);

    await emitter.emit(sampleEvent());
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();

    await emitter.emit(sampleEvent({ status: 'done' }));
    // still 1 — unsubscribed before second emit
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('multiple subscribers all receive each event', async () => {
    const persist = vi.fn(async () => {});
    const emitter = createEventEmitter({ persist });

    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();
    emitter.subscribe(h1);
    emitter.subscribe(h2);
    emitter.subscribe(h3);

    const event = sampleEvent({ step: 'verify', status: 'done' });
    await emitter.emit(event);

    expect(h1).toHaveBeenCalledWith(event);
    expect(h2).toHaveBeenCalledWith(event);
    expect(h3).toHaveBeenCalledWith(event);
  });

  it('awaits persist before resolving emit', async () => {
    const order: string[] = [];
    const persist = vi.fn(async (_e: UpdateEvent) => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('persist-done');
    });
    const emitter = createEventEmitter({ persist });

    await emitter.emit(sampleEvent());
    order.push('emit-resolved');

    expect(order).toEqual(['persist-done', 'emit-resolved']);
  });

  it('unsubscribe is idempotent and only removes the matching handler', async () => {
    const persist = vi.fn(async () => {});
    const emitter = createEventEmitter({ persist });

    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = emitter.subscribe(h1);
    emitter.subscribe(h2);

    unsub1();
    unsub1(); // calling again should not throw or affect h2

    await emitter.emit(sampleEvent());
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
