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
    const adapter = new ElectronCaptureAdapter({
      screen: createScreen(),
      desktopCapturer,
      platform: 'darwin',
      getScreenPermissionStatus: () => 'denied',
    });

    await expect(adapter.capture()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
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
