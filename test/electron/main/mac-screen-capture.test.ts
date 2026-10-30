import { describe, it, expect, vi } from 'vitest';
import { NativeMacScreenCapture } from '../../../src/electron/main/mac-screen-capture.js';
import { ElectronCaptureAdapter } from '../../../src/electron/main/electron-capture-adapter.js';
import { ScreenshotError } from '../../../src/electron/main/errors.js';

const display = {
  id: '10',
  bounds: { x: -800, y: -200, width: 800, height: 600 },
  scaleFactor: 2,
};
function png() {
  const header = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(header);
  header.write('IHDR', 12);
  header.writeUInt32BE(1600, 16);
  header.writeUInt32BE(1200, 20);
  return 'data:image/png;base64,' + header.toString('base64');
}

describe('macOS native pixel path', () => {
  it.each(['denied', 'restricted'] as const)(
    'uses helper authorization for live mode when host permission is %s, but preserves frozen checks',
    async (hostStatus) => {
      const source = { ...display, id: 10 };
      const native = {
        prepare: vi.fn(async () => {}),
        dispose: vi.fn(),
        capture: vi.fn(async () => png()),
      };
      const permission = vi.fn(() => hostStatus);
      const settings = vi.fn(async () => {});
      const desktop = { getSources: vi.fn(async () => []) };
      const adapter = new ElectronCaptureAdapter({
        platform: 'darwin',
        macCapture: native,
        desktopCapturer: desktop,
        getScreenPermissionStatus: permission,
        openScreenCaptureSettings: settings,
        screen: {
          getAllDisplays: () => [source],
          getCursorScreenPoint: () => ({ x: -400, y: 0 }),
          getDisplayNearestPoint: () => source,
          getPrimaryDisplay: () => source,
        },
      });
      try {
        await adapter.capture({ interactionMode: 'live' }, display, undefined, {
          excludedWindowIds: ['123'],
        });
        expect(native.capture).toHaveBeenCalledOnce();
        expect(permission).not.toHaveBeenCalled();
        expect(settings).not.toHaveBeenCalled();
        await expect(
          adapter.capture({ interactionMode: 'frozen' }, display)
        ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
        expect(permission).toHaveBeenCalledOnce();
        expect(desktop.getSources).not.toHaveBeenCalled();
        expect(settings).toHaveBeenCalledTimes(hostStatus === 'denied' ? 1 : 0);
      } finally {
        adapter.dispose();
      }
    }
  );

  it('propagates native permission denial without an Electron fallback or host settings prompt', async () => {
    const native = {
      prepare: vi.fn(async () => {}),
      dispose: vi.fn(),
      capture: vi.fn(async () => {
        throw new ScreenshotError('PERMISSION_DENIED', 'Native permission denied');
      }),
    };
    const source = { ...display, id: 10 };
    const desktop = { getSources: vi.fn(async () => []) },
      settings = vi.fn();
    const adapter = new ElectronCaptureAdapter({
      platform: 'darwin',
      macCapture: native,
      desktopCapturer: desktop,
      getScreenPermissionStatus: () => 'granted',
      openScreenCaptureSettings: settings,
      screen: {
        getAllDisplays: () => [source],
        getCursorScreenPoint: () => ({ x: 0, y: 0 }),
        getDisplayNearestPoint: () => source,
        getPrimaryDisplay: () => source,
      },
    });
    try {
      await expect(
        adapter.capture({ interactionMode: 'live' }, display, undefined, {
          excludedWindowIds: ['123'],
        })
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      expect(desktop.getSources).not.toHaveBeenCalled();
      expect(settings).not.toHaveBeenCalled();
    } finally {
      adapter.dispose();
    }
  });
  it('requires precise overlay IDs, passes limits and abort, and rejects corrupt frames', async () => {
    const client = {
      prepare: vi.fn(async () => {}),
      dispose: vi.fn(),
      request: vi.fn(async () => ({ dataUrl: png() })),
    };
    const native = new NativeMacScreenCapture(undefined, client);
    await native.prepare();
    expect(client.request).not.toHaveBeenCalled();
    await expect(native.capture(display, [], 10000, 5000000)).rejects.toThrow(
      /CGWindowIDs/
    );
    await expect(native.capture(display, ['0'], 10000, 5000000)).rejects.toThrow(
      /CGWindowIDs/
    );
    const signal = new AbortController().signal;
    expect(await native.capture(display, ['123', '456'], 10000, 5000000, signal)).toBe(
      png()
    );
    expect(client.request).toHaveBeenCalledWith(
      {
        command: 'capture',
        displayId: '10',
        excludedWindowIds: ['123', '456'],
        maxBytes: 10000,
        maxPixels: 5000000,
      },
      { signal, maxBytes: 14096 }
    );
    client.request.mockResolvedValue({ dataUrl: 'not-png' });
    await expect(native.capture(display, ['123'], 10000, 5000000)).rejects.toThrow(
      /Invalid/
    );
    native.dispose();
    expect(client.dispose).toHaveBeenCalledOnce();
  });

  it('routes live and fallback through SCK, preserves screen-local DIP and reports actual Retina pixels', async () => {
    const native = {
      prepare: vi.fn(async () => {}),
      dispose: vi.fn(),
      capture: vi.fn(async () => png()),
    };
    const source = { ...display, id: 10 };
    const desktopCapturer = { getSources: vi.fn(async () => []) };
    const adapter = new ElectronCaptureAdapter({
      platform: 'darwin',
      macCapture: native,
      desktopCapturer,
      getScreenPermissionStatus: () => 'granted',
      screen: {
        getAllDisplays: () => [source],
        getCursorScreenPoint: () => ({ x: -400, y: 0 }),
        getDisplayNearestPoint: () => source,
        getPrimaryDisplay: () => source,
      },
    });
    await adapter.prepare({ interactionMode: 'live' });
    expect(native.capture).not.toHaveBeenCalled();
    const signal = new AbortController().signal,
      context = { excludedWindowIds: ['123'] };
    const [frame] = await adapter.capture(
      { interactionMode: 'live' },
      display,
      signal,
      context
    );
    expect(native.capture).toHaveBeenCalledWith(
      display,
      ['123'],
      expect.any(Number),
      expect.any(Number),
      signal
    );
    expect(frame).toMatchObject({
      kind: 'image',
      display,
      pixelSize: { width: 1600, height: 1200 },
    });
    await adapter.captureFallback(
      { interactionMode: 'live' },
      display,
      signal,
      context
    );
    expect(native.capture).toHaveBeenCalledTimes(2);
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    adapter.dispose();
    expect(native.dispose).toHaveBeenCalledOnce();
  });
});
