import { EventEmitter } from 'node:events';
import type { BrowserWindowConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { OverlayWindow, type OverlayBrowserWindow } from './overlay-window.js';

describe('OverlayWindow', () => {
  it('creates a hidden and isolated window for the target display', async () => {
    const receivedOptions: BrowserWindowConstructorOptions[] = [];
    const windows: ReturnType<typeof createFakeWindow>[] = [];

    const overlay = new OverlayWindow({
      display: {
        id: '10',
        bounds: { x: -800, y: 0, width: 800, height: 600 },
        scaleFactor: 1,
      },
      resources: {
        htmlPath: 'dist/overlay/index.html',
        preloadPath: 'dist/overlay/preload.cjs',
      },
      resourceExists: () => true,
      createWindow(options) {
        receivedOptions.push(options);
        const fake = createFakeWindow(99 + windows.length);
        windows.push(fake);
        return fake.window;
      },
      platform: 'win32',
    });

    await overlay.load();
    overlay.prime();
    overlay.reveal();

    const capture = windows[0];
    expect(capture).toBeDefined();
    expect(receivedOptions[0]).toMatchObject({
      x: -800,
      y: 0,
      width: 800,
      height: 600,
      useContentSize: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      transparent: false,
      show: false,
      opacity: 0,
      paintWhenInitiallyHidden: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: 'dist/overlay/preload.cjs',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        zoomFactor: 1,
      },
    });
    expect(capture?.loadFile).toHaveBeenCalledWith('dist/overlay/index.html');
    expect(capture?.show).not.toHaveBeenCalled();
    expect(capture?.showInactive).toHaveBeenCalledOnce();
    expect(capture?.setBounds).toHaveBeenCalledWith(
      { x: -800, y: 0, width: 800, height: 600 },
      false
    );
    expect(capture?.setOpacity).toHaveBeenCalledWith(1);
    expect(capture?.setAlwaysOnTop).toHaveBeenCalledTimes(2);
    expect(capture?.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true, 'screen-saver');
    expect(capture?.setAlwaysOnTop).toHaveBeenNthCalledWith(2, true, 'screen-saver');
    expect(capture?.moveTop).toHaveBeenCalledTimes(2);
    expect(capture?.focus).toHaveBeenCalledOnce();
    expect(overlay.webContentsId).toBe(99);

    vi.useFakeTimers();
    overlay.showCopyFeedback(3_000, { locale: 'zh-CN' });
    await Promise.resolve();
    await Promise.resolve();

    const feedback = windows[1];
    expect(feedback).toBeDefined();
    expect(capture?.destroy).toHaveBeenCalledOnce();
    expect(receivedOptions[1]).toMatchObject({
      x: -580,
      y: 24,
      width: 360,
      height: 72,
      transparent: true,
      focusable: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { zoomFactor: 1 },
    });
    expect(feedback?.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(feedback?.send).toHaveBeenCalledWith('electron-snapora:overlay:feedback', {
      kind: 'copy',
      durationMs: 3_000,
      options: { locale: 'zh-CN' },
    });
    expect(feedback?.showInactive).not.toHaveBeenCalled();
    feedback?.webContentsEvents.emit(
      'ipc-message',
      {},
      'electron-snapora:overlay:feedback-ready'
    );
    expect(feedback?.showInactive).toHaveBeenCalledOnce();
    expect(feedback?.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(feedback?.moveTop).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2_999);
    expect(feedback?.destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(feedback?.destroy).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('does not access webContents while cleaning up a destroyed window', () => {
    let destroyed = false;
    const removeWebContentsListener = vi.fn();
    const fakeWindow = {
      webContents: {
        id: 99,
        on: vi.fn(),
        removeListener: removeWebContentsListener,
        send: vi.fn(),
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => destroyed),
      loadFile: vi.fn(async () => undefined),
      on: vi.fn(),
      removeListener: vi.fn(),
      setBounds: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setOpacity: vi.fn(),
      moveTop: vi.fn(),
      show: vi.fn(),
      showInactive: vi.fn(),
      focus: vi.fn(),
    } as unknown as OverlayBrowserWindow;
    const overlay = new OverlayWindow({
      display: {
        id: '10',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        scaleFactor: 1,
      },
      resources: { htmlPath: 'overlay.html', preloadPath: 'preload.cjs' },
      resourceExists: () => true,
      createWindow: () => fakeWindow,
    });
    const cleanup = overlay.onRendererGone(vi.fn());

    destroyed = true;
    expect(cleanup).not.toThrow();
    expect(removeWebContentsListener).not.toHaveBeenCalled();
  });
});

function createFakeWindow(id: number) {
  const webContentsEvents = new EventEmitter();
  let destroyed = false;
  const send = vi.fn();
  const destroy = vi.fn(() => {
    destroyed = true;
  });
  const loadFile = vi.fn(async () => undefined);
  const show = vi.fn();
  const showInactive = vi.fn();
  const setOpacity = vi.fn();
  const setBounds = vi.fn();
  const setIgnoreMouseEvents = vi.fn();
  const setAlwaysOnTop = vi.fn();
  const moveTop = vi.fn();
  const focus = vi.fn();
  const window = {
    webContents: {
      id,
      on: webContentsEvents.on.bind(webContentsEvents),
      removeListener: webContentsEvents.removeListener.bind(webContentsEvents),
      send,
    },
    destroy,
    isDestroyed: vi.fn(() => destroyed),
    loadFile,
    on: vi.fn(),
    removeListener: vi.fn(),
    setBounds,
    setIgnoreMouseEvents,
    setAlwaysOnTop,
    setOpacity,
    moveTop,
    show,
    showInactive,
    focus,
  } as unknown as OverlayBrowserWindow;

  return {
    window,
    webContentsEvents,
    send,
    destroy,
    loadFile,
    show,
    showInactive,
    setOpacity,
    setBounds,
    setIgnoreMouseEvents,
    setAlwaysOnTop,
    moveTop,
    focus,
  };
}
