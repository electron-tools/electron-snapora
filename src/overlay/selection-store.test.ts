import { describe, expect, it, vi } from 'vitest';
import type { ScreenshotInitializePayload } from '../electron/protocol/messages.js';
import { SCREENSHOT_PROTOCOL_VERSION } from '../electron/protocol/messages.js';
import { createOverlayStore } from './selection-store.js';

const payload: ScreenshotInitializePayload = {
  protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
  jobId: 'job-1',
  options: {},
  frames: [
    {
      display: {
        id: 'display-1',
        bounds: { x: 0, y: 0, width: 100, height: 80 },
        scaleFactor: 1,
      },
      dataUrl: 'data:image/png;base64,AA==',
      pixelSize: { width: 100, height: 80 },
    },
  ],
};
const bounds = { x: 0, y: 0, width: 100, height: 80 };

describe('overlay selection store', () => {
  it('uses a one-way action flow to create, move and resize a selection', () => {
    const store = createOverlayStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispatch({ type: 'initialize', payload });
    store.dispatch({ type: 'image-ready' });
    store.dispatch({
      type: 'begin-create',
      pointerId: 1,
      point: { x: 80, y: 70 },
      bounds,
    });
    store.dispatch({
      type: 'pointer-move',
      pointerId: 1,
      point: { x: 20, y: 10 },
      bounds,
    });
    store.dispatch({ type: 'end-interaction', pointerId: 1 });

    expect(store.getState()).toMatchObject({
      phase: 'selected',
      selection: { x: 20, y: 10, width: 60, height: 60 },
      interaction: null,
    });

    store.dispatch({ type: 'begin-move', pointerId: 2, point: { x: 30, y: 20 } });
    store.dispatch({
      type: 'pointer-move',
      pointerId: 2,
      point: { x: 90, y: 90 },
      bounds,
    });
    store.dispatch({ type: 'end-interaction', pointerId: 2 });
    expect(store.getState().selection).toEqual({ x: 40, y: 20, width: 60, height: 60 });

    store.dispatch({ type: 'begin-resize', pointerId: 3, handle: 'nw' });
    store.dispatch({
      type: 'pointer-move',
      pointerId: 3,
      point: { x: 10, y: 5 },
      bounds,
    });
    store.dispatch({ type: 'end-interaction', pointerId: 3 });
    expect(store.getState().selection).toEqual({ x: 10, y: 5, width: 90, height: 75 });
    expect(listener).toHaveBeenCalled();
  });

  it('discards a click-sized selection below the minimum threshold', () => {
    const store = createOverlayStore();
    store.dispatch({ type: 'initialize', payload });
    store.dispatch({ type: 'image-ready' });
    store.dispatch({
      type: 'begin-create',
      pointerId: 1,
      point: { x: 10, y: 10 },
      bounds,
    });
    store.dispatch({
      type: 'pointer-move',
      pointerId: 1,
      point: { x: 12, y: 12 },
      bounds,
    });
    store.dispatch({ type: 'end-interaction', pointerId: 1 });

    expect(store.getState()).toMatchObject({ phase: 'ready', selection: null });
  });

  it('accepts export only from the selected phase', () => {
    const store = createOverlayStore();
    store.dispatch({ type: 'begin-export' });
    expect(store.getState().phase).toBe('waiting');

    store.dispatch({ type: 'initialize', payload });
    store.dispatch({ type: 'image-ready' });
    store.dispatch({
      type: 'begin-create',
      pointerId: 1,
      point: { x: 10, y: 10 },
      bounds,
    });
    store.dispatch({
      type: 'pointer-move',
      pointerId: 1,
      point: { x: 20, y: 20 },
      bounds,
    });
    store.dispatch({ type: 'end-interaction', pointerId: 1 });
    store.dispatch({ type: 'begin-export' });
    expect(store.getState().phase).toBe('exporting');
  });

  it('clears cached session data after completion or cancellation', () => {
    const store = createOverlayStore();
    store.dispatch({ type: 'initialize', payload });
    store.dispatch({ type: 'image-ready' });
    store.dispatch({
      type: 'begin-create',
      pointerId: 1,
      point: { x: 10, y: 10 },
      bounds,
    });
    store.dispatch({
      type: 'pointer-move',
      pointerId: 1,
      point: { x: 20, y: 20 },
      bounds,
    });
    store.dispatch({ type: 'end-interaction', pointerId: 1 });

    store.dispatch({ type: 'reset' });

    expect(store.getState()).toEqual({
      phase: 'waiting',
      payload: null,
      selection: null,
      interaction: null,
    });
  });
});
