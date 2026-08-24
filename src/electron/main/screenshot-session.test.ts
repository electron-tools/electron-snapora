import { EventEmitter } from 'node:events';
import type { IpcMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import {
  SCREENSHOT_PROTOCOL_VERSION,
  type CapturedFrame,
} from '../protocol/messages.js';
import type { ScreenshotOverlayWindow } from './overlay-window.js';
import type {
  ScreenshotDiagnosticEvent,
  ScreenshotDiagnosticListener,
} from './diagnostics.js';
import { PackagedResourceError } from './resource-paths.js';
import { ScreenshotSession } from './screenshot-session.js';

const frame: CapturedFrame = {
  display: {
    id: '10',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    scaleFactor: 1,
  },
  dataUrl: 'data:image/png;base64,c25hcG9yYQ==',
  pixelSize: { width: 800, height: 600 },
};

const desktopSourceFrame: CapturedFrame = {
  kind: 'desktop-source',
  display: frame.display,
  sourceId: 'screen:10:0',
  pixelSize: frame.pixelSize,
};

function createOverlay() {
  let closedListener: (() => void) | undefined;
  let rendererGoneListener: (() => void) | undefined;
  const overlay: ScreenshotOverlayWindow = {
    webContentsId: 7,
    load: vi.fn(async () => undefined),
    sendInitialize: vi.fn(),
    prime: vi.fn(),
    reveal: vi.fn(),
    showCopyFeedback: vi.fn(),
    destroy: vi.fn(),
    onClosed(listener) {
      closedListener = listener;
      return () => {
        closedListener = undefined;
      };
    },
    onRendererGone(listener) {
      rendererGoneListener = listener;
      return () => {
        rendererGoneListener = undefined;
      };
    },
  };

  return {
    overlay,
    close: () => closedListener?.(),
    rendererGone: () => rendererGoneListener?.(),
  };
}

function emitOverlayMessage(
  ipc: EventEmitter,
  channel: string,
  payload: unknown,
  senderId = 7
): void {
  ipc.emit(channel, { sender: { id: senderId } }, payload);
}

function createSession(
  ipc: EventEmitter,
  overlay: ScreenshotOverlayWindow,
  onDiagnostic?: ScreenshotDiagnosticListener
) {
  return new ScreenshotSession({
    jobId: 'job-1',
    captureOptions: { display: 'cursor', showCopyFeedback: true },
    captureAdapter: {
      capture: vi.fn(async () => [frame]),
    },
    ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
    createOverlay: () => overlay,
    overlayReadyTimeoutMs: 1_000,
    ...(onDiagnostic ? { onDiagnostic } : {}),
  });
}

describe('ScreenshotSession', () => {
  it('loads a hidden overlay while the screen capture is still pending', async () => {
    const ipc = new EventEmitter();
    const { overlay } = createOverlay();
    let finishCapture: ((frames: CapturedFrame[]) => void) | undefined;
    const capture = vi.fn(
      () =>
        new Promise<CapturedFrame[]>((resolve) => {
          finishCapture = resolve;
        })
    );
    const session = new ScreenshotSession({
      jobId: 'parallel-overlay',
      captureOptions: { display: 'cursor' },
      captureAdapter: {
        resolveTargetDisplay: vi.fn(() => frame.display),
        capture,
      },
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
      createOverlay: () => overlay,
      overlayReadyTimeoutMs: 1_000,
    });

    const resultPromise = session.run();
    await vi.waitFor(() => expect(overlay.load).toHaveBeenCalledOnce());
    expect(session.state).toBe('capturing');
    expect(capture).toHaveBeenCalledWith({ display: 'cursor' }, frame.display);

    emitOverlayMessage(ipc, OVERLAY_CHANNELS.ready, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
    });
    expect(overlay.prime).not.toHaveBeenCalled();

    finishCapture?.([frame]);
    await vi.waitFor(() => expect(overlay.sendInitialize).toHaveBeenCalledOnce());
    expect(overlay.prime).toHaveBeenCalledOnce();

    emitOverlayMessage(ipc, OVERLAY_CHANNELS.prepared, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'parallel-overlay',
    });
    emitOverlayMessage(ipc, OVERLAY_CHANNELS.cancel, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'parallel-overlay',
    });
    await expect(resultPromise).resolves.toEqual({ status: 'cancelled' });
  });

  it('retries the current session with an image when desktop stream capture fails', async () => {
    const ipc = new EventEmitter();
    const { overlay } = createOverlay();
    const captureFallback = vi.fn(async () => [frame]);
    const session = new ScreenshotSession({
      jobId: 'source-fallback',
      captureOptions: { display: 'cursor' },
      captureAdapter: {
        capture: vi.fn(async () => [desktopSourceFrame]),
        captureFallback,
      },
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
      createOverlay: () => overlay,
      overlayReadyTimeoutMs: 1_000,
    });

    const resultPromise = session.run();
    await vi.waitFor(() => expect(overlay.load).toHaveBeenCalledOnce());
    emitOverlayMessage(ipc, OVERLAY_CHANNELS.ready, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
    });
    await vi.waitFor(() => expect(overlay.sendInitialize).toHaveBeenCalledOnce());
    expect(overlay.sendInitialize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ frames: [desktopSourceFrame] })
    );

    emitOverlayMessage(ipc, OVERLAY_CHANNELS.error, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'source-fallback',
      code: 'CAPTURE_FAILED',
      message: 'Desktop stream failed.',
      fallback: 'capture-image',
    });

    await vi.waitFor(() => expect(overlay.sendInitialize).toHaveBeenCalledTimes(2));
    expect(captureFallback).toHaveBeenCalledWith({ display: 'cursor' }, frame.display);
    expect(overlay.sendInitialize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ frames: [frame] })
    );

    emitOverlayMessage(ipc, OVERLAY_CHANNELS.prepared, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'source-fallback',
    });
    emitOverlayMessage(ipc, OVERLAY_CHANNELS.cancel, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'source-fallback',
    });
    await expect(resultPromise).resolves.toEqual({ status: 'cancelled' });
  });

  it('destroys a reusable overlay when cancellation interrupts desktop streaming', async () => {
    const ipc = new EventEmitter();
    const { overlay: baseOverlay } = createOverlay();
    const hide = vi.fn();
    const overlay: ScreenshotOverlayWindow = {
      ...baseOverlay,
      rendererReady: true,
      hide,
    };
    const session = new ScreenshotSession({
      jobId: 'cancel-source-stream',
      captureOptions: {},
      captureAdapter: { capture: vi.fn(async () => [desktopSourceFrame]) },
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
      createOverlay: () => overlay,
    });

    const resultPromise = session.run();
    await vi.waitFor(() => expect(overlay.sendInitialize).toHaveBeenCalledOnce());
    expect(session.cancel()).toBe(true);

    await expect(resultPromise).resolves.toEqual({ status: 'cancelled' });
    expect(overlay.destroy).toHaveBeenCalledOnce();
    expect(hide).not.toHaveBeenCalled();
  });

  it('rejects oversized frames returned by a custom capture adapter', async () => {
    const ipc = new EventEmitter();
    const { overlay } = createOverlay();
    const session = new ScreenshotSession({
      jobId: 'oversized-frame',
      captureOptions: {},
      captureAdapter: { capture: vi.fn(async () => [frame]) },
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
      createOverlay: () => overlay,
      resourceLimits: { maxCapturePixels: 100 },
    });

    await expect(session.run()).resolves.toMatchObject({
      status: 'failed',
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });
    expect(overlay.load).not.toHaveBeenCalled();
  });

  it('fails safely when a preloaded target display changes before capture completes', async () => {
    const ipc = new EventEmitter();
    const { overlay } = createOverlay();
    const movedFrame = {
      ...frame,
      display: {
        ...frame.display,
        bounds: { ...frame.display.bounds, x: 1920 },
      },
    };
    const session = new ScreenshotSession({
      jobId: 'display-changed',
      captureOptions: { display: 'cursor' },
      captureAdapter: {
        resolveTargetDisplay: () => frame.display,
        capture: vi.fn(async () => [movedFrame]),
      },
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
      createOverlay: () => overlay,
    });

    await expect(session.run()).resolves.toMatchObject({
      status: 'failed',
      code: 'DISPLAY_NOT_FOUND',
    });
    expect(overlay.destroy).toHaveBeenCalledOnce();
    expect(overlay.prime).not.toHaveBeenCalled();
  });

  it('supports programmatic cancellation while screen capture is pending', async () => {
    const ipc = new EventEmitter();
    const { overlay } = createOverlay();
    let finishCapture: ((frames: CapturedFrame[]) => void) | undefined;
    const session = new ScreenshotSession({
      jobId: 'cancel-pending',
      captureOptions: {},
      captureAdapter: {
        capture: vi.fn(
          () =>
            new Promise<CapturedFrame[]>((resolve) => {
              finishCapture = resolve;
            })
        ),
      },
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
      createOverlay: () => overlay,
    });

    const resultPromise = session.run();
    expect(session.state).toBe('capturing');
    expect(session.cancel()).toBe(true);
    expect(session.cancel()).toBe(false);
    finishCapture?.([frame]);

    await expect(resultPromise).resolves.toEqual({ status: 'cancelled' });
    await Promise.resolve();
    expect(overlay.load).not.toHaveBeenCalled();
  });

  it('captures before opening the overlay and resolves a validated result once', async () => {
    const ipc = new EventEmitter();
    const { overlay } = createOverlay();
    const diagnostics: ScreenshotDiagnosticEvent[] = [];
    const session = createSession(ipc, overlay, (event) => diagnostics.push(event));
    const resultPromise = session.run();

    await vi.waitFor(() => expect(overlay.load).toHaveBeenCalledOnce());
    emitOverlayMessage(ipc, OVERLAY_CHANNELS.ready, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
    });

    expect(overlay.sendInitialize).toHaveBeenCalledWith({
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'job-1',
      options: { display: 'cursor', showCopyFeedback: true },
      frames: [frame],
    });
    expect(session.state).toBe('preparing-overlay');
    expect(overlay.prime).toHaveBeenCalledOnce();
    expect(overlay.reveal).not.toHaveBeenCalled();

    emitOverlayMessage(ipc, OVERLAY_CHANNELS.prepared, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'job-1',
    });
    expect(overlay.reveal).toHaveBeenCalledOnce();
    expect(session.state).toBe('editing');

    const completedResult = {
      status: 'completed' as const,
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png' as const,
      bounds: { x: 10, y: 20, width: 100, height: 80 },
      displayId: '10',
      output: { action: 'copy' as const },
    };
    emitOverlayMessage(ipc, OVERLAY_CHANNELS.confirm, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'job-1',
      result: completedResult,
    });

    await expect(resultPromise).resolves.toEqual(completedResult);
    expect(session.state).toBe('completed');
    expect(overlay.showCopyFeedback).toHaveBeenCalledWith(3_000, {
      display: 'cursor',
      showCopyFeedback: true,
    });
    expect(overlay.destroy).not.toHaveBeenCalled();
    expect(ipc.listenerCount(OVERLAY_CHANNELS.confirm)).toBe(0);
    expect(ipc.listenerCount(OVERLAY_CHANNELS.prepared)).toBe(0);
    expect(diagnostics.map(({ stage, phase }) => `${stage}:${phase}`)).toEqual(
      expect.arrayContaining([
        'capture:start',
        'capture:complete',
        'overlay-create:start',
        'overlay-create:complete',
        'overlay-load:start',
        'overlay-load:complete',
        'overlay-ready:start',
        'overlay-ready:complete',
        'overlay-prepare:start',
        'overlay-prepare:complete',
      ])
    );
    for (const event of diagnostics.filter((event) => event.phase === 'complete')) {
      expect(typeof event.durationMs).toBe('number');
    }
  });

  it('reuses an already-ready overlay without waiting for another ready event', async () => {
    const ipc = new EventEmitter();
    const { overlay: baseOverlay } = createOverlay();
    const hide = vi.fn();
    const overlay: ScreenshotOverlayWindow = {
      ...baseOverlay,
      rendererReady: true,
      hide,
    };
    const diagnostics: ScreenshotDiagnosticEvent[] = [];
    const session = createSession(ipc, overlay, (event) => diagnostics.push(event));
    const resultPromise = session.run();

    await vi.waitFor(() => expect(overlay.sendInitialize).toHaveBeenCalledOnce());
    emitOverlayMessage(ipc, OVERLAY_CHANNELS.prepared, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'job-1',
    });
    emitOverlayMessage(ipc, OVERLAY_CHANNELS.cancel, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'job-1',
    });

    await expect(resultPromise).resolves.toEqual({ status: 'cancelled' });
    expect(hide).toHaveBeenCalledOnce();
    expect(overlay.destroy).not.toHaveBeenCalled();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        stage: 'overlay-ready',
        phase: 'complete',
        context: { reused: true },
      })
    );
  });

  it('reports structured missing-resource context without leaking Electron objects', async () => {
    const ipc = new EventEmitter();
    const diagnostics: ScreenshotDiagnosticEvent[] = [];
    const session = new ScreenshotSession({
      jobId: 'missing-resource',
      captureOptions: {},
      captureAdapter: { capture: vi.fn(async () => [frame]) },
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
      createOverlay: () => {
        throw new PackagedResourceError([
          { label: 'overlay HTML', path: 'C:\\app\\overlay\\index.html' },
        ]);
      },
      onDiagnostic: (event) => diagnostics.push(event),
    });

    await expect(session.run()).resolves.toMatchObject({
      status: 'failed',
      code: 'OVERLAY_LOAD_FAILED',
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        stage: 'overlay-create',
        phase: 'error',
        code: 'OVERLAY_LOAD_FAILED',
        context: {
          errorName: 'PackagedResourceError',
          missingResources: ['overlay HTML: C:\\app\\overlay\\index.html'],
        },
      })
    );
  });

  it('ignores messages from unrelated renderers and cancels on window close', async () => {
    const ipc = new EventEmitter();
    const { overlay, close } = createOverlay();
    const session = createSession(ipc, overlay);
    const resultPromise = session.run();

    await vi.waitFor(() => expect(overlay.load).toHaveBeenCalledOnce());
    emitOverlayMessage(
      ipc,
      OVERLAY_CHANNELS.ready,
      { protocolVersion: SCREENSHOT_PROTOCOL_VERSION },
      999
    );
    expect(overlay.reveal).not.toHaveBeenCalled();

    close();
    await expect(resultPromise).resolves.toEqual({ status: 'cancelled' });
    expect(session.state).toBe('cancelled');
  });

  it('fails a malformed message from the active overlay', async () => {
    const ipc = new EventEmitter();
    const { overlay } = createOverlay();
    const session = createSession(ipc, overlay);
    const resultPromise = session.run();

    await vi.waitFor(() => expect(overlay.load).toHaveBeenCalledOnce());
    emitOverlayMessage(ipc, OVERLAY_CHANNELS.ready, { protocolVersion: 999 });

    await expect(resultPromise).resolves.toMatchObject({
      status: 'failed',
      code: 'INVALID_RESULT',
    });
    expect(session.state).toBe('failed');
  });

  it('normalizes capture and overlay load failures', async () => {
    const ipc = new EventEmitter();
    const { overlay } = createOverlay();
    const captureSession = new ScreenshotSession({
      jobId: 'capture-error',
      captureOptions: {},
      captureAdapter: {
        capture: vi.fn(async () => {
          throw new Error('capture broke');
        }),
      },
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
      createOverlay: () => overlay,
    });

    await expect(captureSession.run()).resolves.toEqual({
      status: 'failed',
      code: 'CAPTURE_FAILED',
      message: 'capture broke',
    });

    const failingOverlay = {
      ...overlay,
      load: vi.fn(async () => {
        throw new Error('load broke');
      }),
    };
    const overlaySession = createSession(ipc, failingOverlay);

    await expect(overlaySession.run()).resolves.toEqual({
      status: 'failed',
      code: 'OVERLAY_LOAD_FAILED',
      message: 'load broke',
    });
  });
});
