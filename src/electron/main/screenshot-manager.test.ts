import { EventEmitter } from 'node:events';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import type { ScreenshotResult } from '../../types.js';
import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import {
  SCREENSHOT_PROTOCOL_VERSION,
  type CapturedFrame,
  type ScreenshotOutputPayload,
} from '../protocol/messages.js';
import type { ScreenshotOverlayWindow } from './overlay-window.js';
import { ScreenshotManager } from './screenshot-manager.js';

const frame: CapturedFrame = {
  display: {
    id: 'display-1',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    scaleFactor: 1,
  },
  dataUrl: 'data:image/png;base64,c25hcG9yYQ==',
  pixelSize: { width: 800, height: 600 },
};

function createDeferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value: T) {
      resolvePromise?.(value);
    },
  };
}

describe('ScreenshotManager', () => {
  it('cancels only the task owned by the expected host renderer', async () => {
    const deferred = createDeferred<ScreenshotResult>();
    const cancel = vi.fn(() => {
      deferred.resolve({ status: 'cancelled' });
      return true;
    });
    const manager = new ScreenshotManager({
      runner: () => ({ result: deferred.promise, cancel }),
    });

    const capture = manager.capture({}, { senderWebContentsId: 7 });
    expect(manager.cancel(99)).toBe(false);
    expect(manager.cancel(7)).toBe(true);
    await expect(capture).resolves.toEqual({ status: 'cancelled' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(manager.cancel()).toBe(false);
  });

  it('accepts high-level capture, output and overlay dependencies', async () => {
    let outputHandler:
      ((event: IpcMainInvokeEvent, payload: unknown) => unknown) | undefined;
    const eventBus = new EventEmitter();
    const ipcMain = Object.assign(eventBus, {
      handle: vi.fn((channel: string, handler: typeof outputHandler) => {
        expect(channel).toBe(OVERLAY_CHANNELS.output);
        outputHandler = handler;
      }),
    }) as unknown as Pick<IpcMain, 'handle' | 'on' | 'removeListener'>;
    const captureAdapter = {
      capture: vi.fn(async () => [frame]),
    };
    const outputAdapter = {
      execute: vi.fn(async () => ({
        status: 'completed' as const,
        action: 'copy' as const,
      })),
    };
    const overlay: ScreenshotOverlayWindow = {
      webContentsId: 7,
      load: vi.fn(async () => undefined),
      sendInitialize: vi.fn(),
      prime: vi.fn(),
      reveal: vi.fn(),
      destroy: vi.fn(),
      onClosed: vi.fn(() => vi.fn()),
      onRendererGone: vi.fn(() => vi.fn()),
    };
    const createOverlay = vi.fn(() => overlay);
    const manager = new ScreenshotManager({
      ipcMain,
      captureAdapter,
      outputAdapter,
      createOverlay,
      overlayReadyTimeoutMs: 1_000,
      resourceLimits: { maxOutputBytes: 3 },
    });

    const resultPromise = manager.capture({ locale: 'zh-CN' });
    await vi.waitFor(() => expect(overlay.load).toHaveBeenCalledOnce());
    const overlayEvent = { sender: { id: 7 } };
    eventBus.emit(OVERLAY_CHANNELS.ready, overlayEvent, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
    });
    eventBus.emit(OVERLAY_CHANNELS.prepared, overlayEvent, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: manager.activeJobId,
    });

    const imageResult = {
      status: 'completed' as const,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png' as const,
      bounds: { x: 10, y: 20, width: 100, height: 80 },
      displayId: 'display-1',
    };
    const outputPayload: ScreenshotOutputPayload = {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: manager.activeJobId ?? '',
      action: 'copy',
      result: imageResult,
    };
    await expect(
      outputHandler?.({ sender: { id: 7 } } as IpcMainInvokeEvent, {
        ...outputPayload,
        result: { ...imageResult, data: new Uint8Array([1, 2, 3, 4]) },
      })
    ).resolves.toMatchObject({
      status: 'failed',
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });
    expect(outputAdapter.execute).not.toHaveBeenCalled();
    await expect(
      outputHandler?.({ sender: { id: 7 } } as IpcMainInvokeEvent, outputPayload)
    ).resolves.toEqual({ status: 'completed', action: 'copy' });
    eventBus.emit(OVERLAY_CHANNELS.confirm, overlayEvent, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: manager.activeJobId,
      result: { ...imageResult, output: { action: 'copy' } },
    });

    await expect(resultPromise).resolves.toMatchObject({
      status: 'completed',
      output: { action: 'copy' },
    });
    expect(captureAdapter.capture).toHaveBeenCalledWith({ locale: 'zh-CN' });
    expect(createOverlay).toHaveBeenCalledWith(frame.display);
    expect(outputAdapter.execute).toHaveBeenCalledWith(outputPayload, {
      senderWebContentsId: 7,
    });
  });

  it('allows only one active screenshot task', async () => {
    const deferred = createDeferred<ScreenshotResult>();
    const manager = new ScreenshotManager({
      runner: () => deferred.promise,
    });

    const firstCapture = manager.capture();
    await expect(manager.capture()).resolves.toMatchObject({
      status: 'failed',
      code: 'CAPTURE_BUSY',
    });

    deferred.resolve({ status: 'cancelled' });
    await expect(firstCapture).resolves.toEqual({ status: 'cancelled' });
    expect(manager.activeJobId).toBeUndefined();
  });

  it('queues different host windows in FIFO order and keeps each window mutexed', async () => {
    const jobs = [
      createDeferred<ScreenshotResult>(),
      createDeferred<ScreenshotResult>(),
      createDeferred<ScreenshotResult>(),
    ];
    let started = 0;
    const startedSenders: Array<number | undefined> = [];
    const runner = vi.fn((_jobId, _options, context) => {
      startedSenders.push(context.senderWebContentsId);
      return jobs[started++]?.promise ?? Promise.reject();
    });
    const manager = new ScreenshotManager({ runner, busyPolicy: 'queue' });

    const first = manager.capture({}, { senderWebContentsId: 1 });
    const second = manager.capture({}, { senderWebContentsId: 2 });
    const third = manager.capture({}, { senderWebContentsId: 3 });
    await expect(
      manager.capture({}, { senderWebContentsId: 2 })
    ).resolves.toMatchObject({ status: 'failed', code: 'CAPTURE_BUSY' });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(manager.queuedCaptureCount).toBe(2);

    jobs[0]?.resolve({ status: 'cancelled' });
    await expect(first).resolves.toEqual({ status: 'cancelled' });
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
    jobs[1]?.resolve({ status: 'cancelled' });
    await expect(second).resolves.toEqual({ status: 'cancelled' });
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(3));
    jobs[2]?.resolve({ status: 'cancelled' });
    await expect(third).resolves.toEqual({ status: 'cancelled' });
    expect(manager.queuedCaptureCount).toBe(0);
    expect(startedSenders).toEqual([1, 2, 3]);
  });

  it('removes queued captures owned by a destroyed or cancelling renderer', async () => {
    const active = createDeferred<ScreenshotResult>();
    const runner = vi.fn(() => active.promise);
    const manager = new ScreenshotManager({ runner, busyPolicy: 'queue' });

    const first = manager.capture({}, { senderWebContentsId: 1 });
    const queued = manager.capture({}, { senderWebContentsId: 2 });
    expect(manager.cancel(2)).toBe(true);
    await expect(queued).resolves.toEqual({ status: 'cancelled' });
    expect(manager.queuedCaptureCount).toBe(0);

    active.resolve({ status: 'cancelled' });
    await expect(first).resolves.toEqual({ status: 'cancelled' });
    expect(runner).toHaveBeenCalledOnce();
  });

  it('rejects a full queue and invalid queue limits', async () => {
    expect(() => new ScreenshotManager({ maxQueuedCaptures: 0 })).toThrowError(
      'maxQueuedCaptures must be an integer between 1 and 100.'
    );
    expect(
      () =>
        new ScreenshotManager({
          busyPolicy: 'later' as unknown as 'queue',
        })
    ).toThrowError('busyPolicy must be either reject or queue.');

    const active = createDeferred<ScreenshotResult>();
    const manager = new ScreenshotManager({
      runner: () => active.promise,
      busyPolicy: 'queue',
      maxQueuedCaptures: 1,
    });
    const first = manager.capture({}, { senderWebContentsId: 1 });
    const second = manager.capture({}, { senderWebContentsId: 2 });
    await expect(
      manager.capture({}, { senderWebContentsId: 3 })
    ).resolves.toMatchObject({ status: 'failed', code: 'CAPTURE_BUSY' });

    expect(manager.cancel(2)).toBe(true);
    await expect(second).resolves.toEqual({ status: 'cancelled' });
    active.resolve({ status: 'cancelled' });
    await first;
  });

  it('normalizes an unexpected runner rejection', async () => {
    const manager = new ScreenshotManager({
      runner: async () => {
        throw new Error('runner broke');
      },
    });

    await expect(manager.capture()).resolves.toEqual({
      status: 'failed',
      code: 'CAPTURE_FAILED',
      message: 'runner broke',
    });
  });
});
