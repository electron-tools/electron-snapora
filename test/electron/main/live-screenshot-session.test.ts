import { EventEmitter } from 'node:events';
import type { IpcMain } from 'electron';
import { screen } from 'electron';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  LiveScreenshotSession,
  isLiveSelection,
  retainStableContainers,
} from '../../../src/electron/main/live-screenshot-session.js';
import type { ScreenshotOverlayWindow } from '../../../src/electron/main/overlay-window.js';
import { OVERLAY_CHANNELS } from '../../../src/electron/protocol/channels.js';
import {
  SCREENSHOT_PROTOCOL_VERSION,
  type CaptureDisplay,
  type CapturedFrame,
} from '../../../src/electron/protocol/messages.js';
import type { ScreenshotSnapRegion } from '../../../src/types.js';
import { ScreenshotManager } from '../../../src/electron/main/screenshot-manager.js';

vi.mock('electron', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  screen: Object.assign(new EventEmitter(), {
    getAllDisplays: vi.fn(),
    getCursorScreenPoint: vi.fn(),
    getDisplayNearestPoint: vi.fn(),
    getPrimaryDisplay: vi.fn(),
  }),
}));
const displays = [
  { id: 1, bounds: { x: -800, y: 0, width: 800, height: 600 }, scaleFactor: 1 },
  { id: 2, bounds: { x: 0, y: 0, width: 1000, height: 700 }, scaleFactor: 1.5 },
];
const rect = { x: 20, y: 30, width: 200, height: 150 };
function fixture(pendingCapture = false) {
  const ipc = new EventEmitter();
  let finishCapture!: (frames: CapturedFrame[]) => void;
  const frame = (display: CaptureDisplay): CapturedFrame => ({
    display,
    dataUrl: 'data:image/png;base64,c25hcG9yYQ==',
    pixelSize: { width: display.bounds.width, height: display.bounds.height },
  });
  const capture = vi.fn(
    async (_options, display: CaptureDisplay, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      return pendingCapture
        ? await new Promise<CapturedFrame[]>((resolve) => {
            finishCapture = resolve;
          })
        : [frame(display)];
    }
  );
  const overlays = displays.map((display): ScreenshotOverlayWindow => ({
    webContentsId: display.id + 10,
    nativeHandle: String(display.id + 100),
    rendererReady: true,
    load: vi.fn(async () => {}),
    sendInitialize: vi.fn(),
    sendSnapRegions: vi.fn(),
    showSelection: vi.fn(),
    prime: vi.fn(),
    reveal: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    onClosed: () => () => {},
    onRendererGone: () => () => {},
  }));
  const provider = vi.fn(async () => []);
  const captureFallback = vi.fn(async (_options, display: CaptureDisplay) => [
    frame(display),
  ]);
  const output = vi.fn(() => vi.fn());
  const session = new LiveScreenshotSession({
    jobId: 'live-job',
    captureOptions: { display: 'all', interactionMode: 'live' },
    captureAdapter: { capture, captureFallback },
    ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
    createOverlay: (display) => overlays[Number(display.id) - 1]!,
    getWindowSnapRegions: provider,
    registerOutputHandler: output,
  });
  function emit(channel: string, index: number, payload: object, subframe = false) {
    const mainFrame = {};
    ipc.emit(
      channel,
      {
        sender: { id: overlays[index]!.webContentsId, mainFrame },
        senderFrame: subframe ? {} : mainFrame,
      },
      { protocolVersion: SCREENSHOT_PROTOCOL_VERSION, jobId: 'live-job', ...payload }
    );
  }
  async function ready() {
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 2; index++)
      emit(OVERLAY_CHANNELS.selectionReady, index, {});
  }
  return {
    session,
    overlays,
    capture,
    captureFallback,
    provider,
    output,
    emit,
    ready,
    frame,
    complete: (frames: CapturedFrame[]) => finishCapture(frames),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(screen.getAllDisplays).mockReturnValue(displays as never);
  vi.mocked(screen.getPrimaryDisplay).mockReturnValue(displays[0] as never);
  vi.mocked(screen.getDisplayNearestPoint).mockReturnValue(displays[0] as never);
  vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: -400, y: 100 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  (screen as unknown as EventEmitter).removeAllListeners();
});

describe('live multi-display lifecycle', () => {
  it('destroys an unsupported overlay even when validation fails before session registration', async () => {
    const f = fixture();
    delete (f.overlays[0] as { nativeHandle?: string }).nativeHandle;
    expect(await f.session.run()).toMatchObject({
      status: 'failed',
      code: 'OVERLAY_LOAD_FAILED',
    });
    expect(f.overlays[0]!.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroys custom windows across sequential dual-display cancellations and manager disposal', async () => {
    const template = fixture().overlays[0]!;
    const created: ScreenshotOverlayWindow[] = [];
    const ipc = Object.assign(new EventEmitter(), { handle: vi.fn() });
    const manager = new ScreenshotManager({
      ipcMain: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener' | 'handle'>,
      captureAdapter: { capture: vi.fn(async () => []) },
      outputAdapter: { execute: vi.fn() },
      createOverlay: () => {
        const closed = new Set<() => void>();
        const overlay = {
          ...template,
          webContentsId: 100 + created.length,
          hide: vi.fn(),
          destroy: vi.fn(() => {
            for (const listener of closed) listener();
          }),
          onClosed(listener: () => void) {
            closed.add(listener);
            return () => {
              closed.delete(listener);
            };
          },
        };
        created.push(overlay);
        return overlay;
      },
    });
    for (let i = 0; i < 2; i++) {
      const result = manager.capture({ display: 'all', interactionMode: 'live' });
      await vi.advanceTimersByTimeAsync(0);
      manager.cancel();
      expect(await result).toEqual({ status: 'cancelled' });
      for (const overlay of created) expect(overlay.destroy).toHaveBeenCalledOnce();
    }
    // Dispose during a third active session must also release both screens, without double destruction.
    const last = manager.capture({ display: 'all', interactionMode: 'live' });
    await vi.advanceTimersByTimeAsync(0);
    manager.dispose();
    expect(await last).toEqual({ status: 'cancelled' });
    expect(created).toHaveLength(6);
    for (const overlay of created) expect(overlay.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the selected window and rectangle when a denied desktop stream falls back to an image', async () => {
    const f = fixture();
    f.capture.mockImplementation(async (_options, display) => [
      {
        kind: 'desktop-source',
        sourceId: 'screen:1:0',
        display,
        pixelSize: { width: display.bounds.width, height: display.bounds.height },
      },
    ]);
    const result = f.session.run();
    await f.ready();
    f.emit(OVERLAY_CHANNELS.selected, 0, { displayId: '1', selection: rect });
    await vi.advanceTimersByTimeAsync(0);
    f.emit(OVERLAY_CHANNELS.error, 0, {
      code: 'CAPTURE_FAILED',
      message: 'CreateForMonitor E_ACCESSDENIED',
      fallback: 'capture-image',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.captureFallback).toHaveBeenCalledExactlyOnceWith(
      { display: '1', interactionMode: 'live' },
      expect.objectContaining({ id: '1' }),
      expect.any(AbortSignal)
    );
    expect(f.overlays[0]!.sendInitialize).toHaveBeenCalledTimes(2);
    expect(f.overlays[0]!.sendInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialSelection: rect,
        frames: [expect.objectContaining({ dataUrl: expect.any(String) })],
      })
    );
    expect(f.overlays[0]!.hide).not.toHaveBeenCalled();
    expect(f.overlays[0]!.destroy).not.toHaveBeenCalled();
    f.emit(OVERLAY_CHANNELS.prepared, 0, {});
    expect(f.overlays[0]!.reveal).toHaveBeenCalledOnce();
    f.emit(OVERLAY_CHANNELS.cancel, 0, {});
    expect(await result).toEqual({ status: 'cancelled' });
  });
  it('does not acquire pixels before selection and accepts only the first valid screen submission', async () => {
    const f = fixture();
    const result = f.session.run();
    await f.ready();
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.provider).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      expect.any(Function),
      { excludedWindowHandles: ['101', '102'] }
    );
    f.emit(OVERLAY_CHANNELS.selected, 0, { displayId: '2', selection: rect });
    f.emit(OVERLAY_CHANNELS.selected, 0, { displayId: '1', selection: rect }, true);
    f.emit(OVERLAY_CHANNELS.selected, 0, {
      displayId: '1',
      selection: { ...rect, x: -1 },
    });
    expect(f.capture).not.toHaveBeenCalled();
    f.emit(OVERLAY_CHANNELS.selected, 1, { displayId: '2', selection: rect });
    f.emit(OVERLAY_CHANNELS.selected, 0, { displayId: '1', selection: rect });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.capture).toHaveBeenCalledOnce();
    expect(f.capture).toHaveBeenCalledWith(
      expect.objectContaining({ display: '2' }),
      expect.objectContaining({ id: '2' }),
      expect.any(AbortSignal)
    );
    expect(f.overlays[0]!.hide).toHaveBeenCalled();
    expect(f.overlays[1]!.sendInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ initialSelection: rect })
    );
    expect(f.output).toHaveBeenCalledWith(12, 'live-job');
    f.emit(OVERLAY_CHANNELS.cancel, 0, {});
    f.emit(OVERLAY_CHANNELS.cancel, 1, {});
    expect(await result).toEqual({ status: 'cancelled' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels while acquiring pixels and does not show a late frame', async () => {
    const f = fixture(true);
    const result = f.session.run();
    await f.ready();
    f.emit(OVERLAY_CHANNELS.selected, 0, { displayId: '1', selection: rect });
    const signal = f.capture.mock.calls[0]![2]!;
    expect(signal.aborted).toBe(false);
    f.emit(OVERLAY_CHANNELS.cancel, 0, {});
    expect(await result).toEqual({ status: 'cancelled' });
    expect(signal.aborted).toBe(true);
    f.complete([f.frame({ ...displays[0]!, id: '1' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.overlays[0]!.sendInitialize).not.toHaveBeenCalled();
    expect(f.overlays[0]!.reveal).not.toHaveBeenCalled();
  });

  it('ignores stale jobs and work-area changes but fails safely on topology changes', async () => {
    const f = fixture();
    const result = f.session.run();
    await f.ready();
    f.emit(OVERLAY_CHANNELS.selected, 0, {
      jobId: 'previous',
      displayId: '1',
      selection: rect,
    });
    (screen as unknown as EventEmitter).emit(
      'display-metrics-changed',
      {},
      displays[0],
      ['workArea']
    );
    expect(f.capture).not.toHaveBeenCalled();
    (screen as unknown as EventEmitter).emit(
      'display-metrics-changed',
      {},
      displays[0],
      ['scaleFactor']
    );
    expect(await result).toMatchObject({ status: 'failed', code: 'DISPLAY_NOT_FOUND' });
    expect(
      f.overlays.every((overlay) => vi.mocked(overlay.hide!).mock.calls.length > 0)
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds initialization of a missing renderer and cleans up without capture', async () => {
    const f = fixture();
    f.overlays[1]!.load = vi.fn(() => new Promise<void>(() => {}));
    const result = f.session.run();
    await vi.advanceTimersByTimeAsync(0);
    f.emit(OVERLAY_CHANNELS.selectionReady, 0, {});
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toMatchObject({
      status: 'failed',
      code: 'OVERLAY_LOAD_FAILED',
    });
    expect(f.capture).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('validates local rectangles independently of negative global monitor origins', () => {
    expect(isLiveSelection(rect, displays[0]!.bounds)).toBe(true);
    for (const selection of [
      { ...rect, x: -1 },
      { ...rect, width: Infinity },
      { ...rect, width: 2 },
      { ...rect, x: 799 },
    ])
      expect(isLiveSelection(selection, displays[0]!.bounds)).toBe(false);
  });

  it('avoids clearing stable panels on each refresh and discards panels of moved windows', () => {
    const window: ScreenshotSnapRegion = {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      kind: 'window',
      windowZOrder: 1,
      sourceProcessId: 10,
    };
    const panel: ScreenshotSnapRegion = { ...window, width: 300, kind: 'container' };
    expect(retainStableContainers([window, panel], [window])).toEqual([window, panel]);
    expect(
      retainStableContainers([window, panel], [{ ...window, x: 100 }])
    ).toHaveLength(1);
    expect(retainStableContainers([window, panel], [window, panel])).toHaveLength(2);
  });
});
