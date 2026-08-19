import type { BrowserWindowConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { OverlayWindow, type OverlayBrowserWindow } from './overlay-window.js';

describe('OverlayWindow', () => {
  it('creates a hidden and isolated window for the target display', async () => {
    let receivedOptions: BrowserWindowConstructorOptions | undefined;
    const loadFile = vi.fn(async () => undefined);
    const show = vi.fn();
    const showInactive = vi.fn();
    const setOpacity = vi.fn();
    const setBounds = vi.fn();
    const setAlwaysOnTop = vi.fn();
    const moveTop = vi.fn();
    const focus = vi.fn();
    const fakeWindow = {
      webContents: {
        id: 99,
        on: vi.fn(),
        removeListener: vi.fn(),
        send: vi.fn(),
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadFile,
      on: vi.fn(),
      removeListener: vi.fn(),
      setBounds,
      setAlwaysOnTop,
      setOpacity,
      moveTop,
      show,
      showInactive,
      focus,
    } as unknown as OverlayBrowserWindow;

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
        receivedOptions = options;
        return fakeWindow;
      },
      platform: 'win32',
    });

    await overlay.load();
    overlay.prime();
    overlay.reveal();

    expect(receivedOptions).toMatchObject({
      x: -800,
      y: 0,
      width: 800,
      height: 600,
      useContentSize: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      opacity: 0,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: 'dist/overlay/preload.cjs',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    expect(loadFile).toHaveBeenCalledWith('dist/overlay/index.html');
    expect(show).not.toHaveBeenCalled();
    expect(showInactive).toHaveBeenCalledOnce();
    expect(setBounds).toHaveBeenCalledWith(
      { x: -800, y: 0, width: 800, height: 600 },
      false
    );
    expect(setOpacity).toHaveBeenCalledWith(1);
    expect(setAlwaysOnTop).toHaveBeenCalledTimes(2);
    expect(setAlwaysOnTop).toHaveBeenNthCalledWith(1, true, 'screen-saver');
    expect(setAlwaysOnTop).toHaveBeenNthCalledWith(2, true, 'screen-saver');
    expect(moveTop).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenCalledOnce();
    expect(overlay.webContentsId).toBe(99);
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
