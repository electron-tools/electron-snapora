import { describe, expect, it, vi } from 'vitest';

import { ElectronCaptureAdapter } from './electron-capture-adapter.js';

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

  it('captures the display nearest to the cursor at physical pixel size', async () => {
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
      thumbnailSize: { width: 1600, height: 1200 },
      fetchWindowIcons: false,
    });
    expect(frames).toEqual([
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
