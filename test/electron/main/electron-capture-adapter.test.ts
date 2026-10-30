import { app } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ElectronCaptureAdapter } from '../../../src/electron/main/electron-capture-adapter.js';

const primaryDisplay = {
  id: 10,
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
};

function createScreen() {
  return {
    getAllDisplays: vi.fn(() => [primaryDisplay]),
    getCursorScreenPoint: vi.fn(() => ({ x: 20, y: 30 })),
    getDisplayNearestPoint: vi.fn(() => primaryDisplay),
    getPrimaryDisplay: vi.fn(() => primaryDisplay),
  };
}

function createDesktopCapturer(displayId = '10') {
  return {
    getSources: vi.fn(async () => [
      {
        id: `screen:${displayId}:0`,
        display_id: displayId,
        thumbnail: {
          getSize: () => ({ width: 1600, height: 1200 }),
          isEmpty: () => false,
          toDataURL: () => 'data:image/png;base64,c25hcG9yYQ==',
        },
      },
    ]),
  };
}

describe('ElectronCaptureAdapter', () => {
  it('prewarms without pixels and captures live Windows bounds through the cursor-free worker', async () => {
    const header = Buffer.alloc(24);
    header.write('IHDR', 12);
    header.writeUInt32BE(1600, 16);
    header.writeUInt32BE(1199, 20);
    const native = {
      prepare: vi.fn(async () => undefined),
      capture: vi.fn(async () => 'data:image/png;base64,' + header.toString('base64')),
      dispose: vi.fn(),
    };
    const physical = { x: -1600, y: 200, width: 1600, height: 1200 };
    const screen = { ...createScreen(), dipToScreenRect: vi.fn(() => physical) };
    const desktopCapturer = createDesktopCapturer();
    const adapter = new ElectronCaptureAdapter({
      screen,
      desktopCapturer,
      platform: 'win32',
      windowsCapture: native,
    });
    await adapter.prepare({ interactionMode: 'live' });
    expect(native.prepare).toHaveBeenCalledOnce();
    expect(native.capture).not.toHaveBeenCalled();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    const [frame] = await adapter.capture(
      { interactionMode: 'live' },
      undefined,
      signal
    );
    expect(screen.dipToScreenRect).toHaveBeenCalledWith(null, primaryDisplay.bounds);
    expect(native.capture).toHaveBeenCalledWith(physical, expect.any(Number), signal);
    expect(frame).toMatchObject({
      kind: 'image',
      pixelSize: { width: 1600, height: 1199 },
    });
    native.capture.mockResolvedValue('data:image/png;base64,broken');
    await expect(adapter.capture({ interactionMode: 'live' })).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
    });
    adapter.dispose();
    expect(native.dispose).toHaveBeenCalledOnce();
  });

  it('fails live capture without falling back to a cursor-embedded desktop stream', async () => {
    const native = {
      prepare: vi.fn(async () => undefined),
      capture: vi.fn(async () => {
        throw new Error('GDI unavailable');
      }),
      dispose: vi.fn(),
    };
    const desktopCapturer = createDesktopCapturer();
    const adapter = new ElectronCaptureAdapter({
      screen: { ...createScreen(), dipToScreenRect: () => primaryDisplay.bounds },
      desktopCapturer,
      platform: 'win32',
      windowsCapture: native,
    });
    await expect(adapter.capture({ interactionMode: 'live' })).rejects.toThrow(
      'GDI unavailable'
    );
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    adapter.dispose();
  });
  afterEach(() => vi.restoreAllMocks());

  it('waits for Electron app readiness before desktop source prewarming', async () => {
    let resolveReady: (() => void) | undefined;
    vi.spyOn(app, 'whenReady').mockReturnValue(
      new Promise<void>((resolve) => {
        resolveReady = resolve;
      })
    );
    const desktopCapturer = createDesktopCapturer();
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer,
      platform: 'win32',
    });

    const preparing = adapter.prepare();
    await Promise.resolve();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();

    resolveReady?.();
    await preparing;
    expect(desktopCapturer.getSources).toHaveBeenCalledOnce();
  });

  it('resolves the target display synchronously for parallel overlay loading', () => {
    const screen = createScreen();
    const adapter = new ElectronCaptureAdapter({
      screen,
      desktopCapturer: createDesktopCapturer(),
      platform: 'win32',
    });

    expect(adapter.resolveTargetDisplay({ display: 'cursor' })).toEqual({
      id: '10',
      bounds: primaryDisplay.bounds,
      scaleFactor: 2,
    });
    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 20, y: 30 });
  });

  it('enumerates only the Windows desktop source id without thumbnails', async () => {
    const screen = createScreen();
    const desktopCapturer = createDesktopCapturer();
    const adapter = new ElectronCaptureAdapter({
      screen,
      desktopCapturer,
      platform: 'win32',
    });

    const frames = await adapter.capture();

    expect(screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    expect(frames).toEqual([
      {
        kind: 'desktop-source',
        display: {
          id: '10',
          bounds: primaryDisplay.bounds,
          scaleFactor: 2,
        },
        sourceId: 'screen:10:0',
        pixelSize: { width: 1600, height: 1200 },
      },
    ]);
  });

  it('reuses a desktop source id prepared before the user starts capture', async () => {
    const desktopCapturer = createDesktopCapturer();
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer,
      platform: 'win32',
    });

    await adapter.prepare();
    desktopCapturer.getSources.mockClear();
    await expect(adapter.capture()).resolves.toMatchObject([
      { kind: 'desktop-source', sourceId: 'screen:10:0' },
    ]);

    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it('captures a legacy image when the Windows renderer requests fallback', async () => {
    const desktopCapturer = createDesktopCapturer();
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer,
      platform: 'win32',
    });

    await expect(
      adapter.captureFallback({}, adapter.resolveTargetDisplay({ display: 'primary' }))
    ).resolves.toEqual([
      {
        display: {
          id: '10',
          bounds: primaryDisplay.bounds,
          scaleFactor: 2,
        },
        dataUrl: 'data:image/png;base64,c25hcG9yYQ==',
        pixelSize: { width: 1600, height: 1200 },
      },
    ]);
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1600, height: 1200 },
      fetchWindowIcons: false,
    });

    desktopCapturer.getSources.mockClear();
    await expect(adapter.capture()).resolves.toMatchObject([
      { dataUrl: 'data:image/png;base64,c25hcG9yYQ==' },
    ]);
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1600, height: 1200 },
      fetchWindowIcons: false,
    });
  });

  it('keeps the pre-resolved cursor display locked while capture is pending', async () => {
    const secondaryDisplay = {
      id: 20,
      bounds: { x: 800, y: 0, width: 1024, height: 768 },
      scaleFactor: 1,
    };
    const screen = createScreen();
    screen.getAllDisplays.mockReturnValue([primaryDisplay, secondaryDisplay]);
    screen.getDisplayNearestPoint
      .mockReturnValueOnce(primaryDisplay)
      .mockReturnValueOnce(secondaryDisplay);
    const desktopCapturer = createDesktopCapturer('10');
    const adapter = new ElectronCaptureAdapter({
      screen,
      desktopCapturer,
      platform: 'win32',
    });

    const targetDisplay = adapter.resolveTargetDisplay({ display: 'cursor' });
    const frames = await adapter.capture({ display: 'cursor' }, targetDisplay);

    expect(screen.getDisplayNearestPoint).toHaveBeenCalledOnce();
    expect(frames[0]?.display.id).toBe('10');
  });

  it('rejects an explicit display that does not exist', async () => {
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer: createDesktopCapturer(),
      platform: 'linux',
    });

    await expect(adapter.capture({ display: '404' })).rejects.toMatchObject({
      code: 'DISPLAY_NOT_FOUND',
    });
  });

  it('rejects denied macOS screen recording permission before capture', async () => {
    const desktopCapturer = createDesktopCapturer();
    const openScreenCaptureSettings = vi.fn(async () => undefined);
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer,
      platform: 'darwin',
      getScreenPermissionStatus: () => 'denied',
      openScreenCaptureSettings,
    });

    await expect(adapter.capture()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    expect(openScreenCaptureSettings).toHaveBeenCalledOnce();
  });

  it('lets first-run macOS capture trigger the native permission prompt', async () => {
    const desktopCapturer = createDesktopCapturer();
    const openScreenCaptureSettings = vi.fn(async () => undefined);
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer,
      platform: 'darwin',
      getScreenPermissionStatus: () => 'not-determined',
      openScreenCaptureSettings,
    });

    await expect(adapter.capture()).resolves.toHaveLength(1);
    expect(desktopCapturer.getSources).toHaveBeenCalledOnce();
    expect(openScreenCaptureSettings).not.toHaveBeenCalled();
  });

  it('does not open settings for restricted macOS permission', async () => {
    const openScreenCaptureSettings = vi.fn(async () => undefined);
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer: createDesktopCapturer(),
      platform: 'darwin',
      getScreenPermissionStatus: () => 'restricted',
      openScreenCaptureSettings,
    });

    await expect(adapter.capture()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(openScreenCaptureSettings).not.toHaveBeenCalled();
  });

  it('maps a macOS first-run capture rejection to permission denied', async () => {
    const getScreenPermissionStatus = vi
      .fn<() => 'not-determined' | 'denied'>()
      .mockReturnValueOnce('not-determined')
      .mockReturnValueOnce('denied');
    const openScreenCaptureSettings = vi.fn(async () => undefined);
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer: {
        getSources: vi.fn(async () => {
          throw new Error('screen recording rejected');
        }),
      },
      platform: 'darwin',
      getScreenPermissionStatus,
      openScreenCaptureSettings,
    });

    await expect(adapter.capture()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(openScreenCaptureSettings).toHaveBeenCalledOnce();
  });

  it('does not guess when Electron cannot map a source to the display', async () => {
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer: createDesktopCapturer('different-display'),
      platform: 'win32',
    });

    await expect(adapter.capture()).rejects.toMatchObject({
      code: 'DISPLAY_NOT_FOUND',
    });
  });

  it('rejects excessive capture dimensions before allocating a thumbnail', async () => {
    const desktopCapturer = createDesktopCapturer();
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer,
      platform: 'win32',
      resourceLimits: { maxCapturePixels: 100 },
    });

    await expect(adapter.capture()).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });
});
