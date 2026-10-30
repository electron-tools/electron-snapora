import { EventEmitter } from 'node:events';
import { app, powerMonitor } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElectronCaptureAdapter } from '../../../src/electron/main/electron-capture-adapter.js';

const displays = [
  { id: 10, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 },
  { id: 20, bounds: { x: 800, y: 0, width: 800, height: 600 }, scaleFactor: 1 },
];
const thumbnail = {
  getSize: () => ({ width: 800, height: 600 }),
  isEmpty: () => false,
  toDataURL: () => 'data:image/png;base64,c25hcG9yYQ==',
};
const originalSources = [
  { id: 'screen:0:0', display_id: '10', thumbnail },
  { id: 'screen:1:0', display_id: '20', thumbnail },
];
const swappedSources = [
  { ...originalSources[0]!, display_id: '20' },
  { ...originalSources[1]!, display_id: '10' },
];

/** 在 Node 中模拟系统通知和采集源换号，不创建真实窗口或修改显示器配置。 */
describe('desktop source cache invalidation', () => {
  const adapters: ElectronCaptureAdapter[] = [];
  afterEach(() => {
    adapters.splice(0).forEach((adapter) => adapter.dispose());
    vi.restoreAllMocks();
  });
  function setup(watch = true) {
    const events = new EventEmitter();
    const screen = {
      getAllDisplays: vi.fn(() => displays),
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => displays[0]!,
      getPrimaryDisplay: () => displays[0]!,
      ...(watch
        ? {
            on: events.on.bind(events),
            removeListener: events.removeListener.bind(events),
          }
        : {}),
    };
    const desktopCapturer = { getSources: vi.fn(async () => originalSources) };
    const adapter = new ElectronCaptureAdapter({
      screen,
      desktopCapturer,
      platform: 'win32',
    });
    adapters.push(adapter);
    return { adapter, desktopCapturer, screen, events };
  }

  it.each([true, false])(
    'keeps the original cache hit path with notifications=%s',
    async (watch) => {
      const { adapter, desktopCapturer } = setup(watch);
      await adapter.prepare();
      const ready = vi.spyOn(app, 'whenReady');
      desktopCapturer.getSources.mockClear();
      for (const display of ['10', '20', '10', '20'])
        await adapter.capture({ display });
      expect(ready).not.toHaveBeenCalled();
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    }
  );

  it.each([
    'display-added',
    'display-removed',
    'display-metrics-changed',
    'resume',
    'unlock-screen',
  ])(
    'refreshes both swapped IDs after %s without requiring geometry changes',
    async (event) => {
      const { adapter, desktopCapturer, events } = setup();
      await adapter.prepare();
      desktopCapturer.getSources.mockResolvedValue(swappedSources);
      if (event === 'resume' || event === 'unlock-screen') powerMonitor.emit(event);
      else events.emit(event, {}, displays[0], ['bounds']);
      await expect(adapter.capture({ display: '10' })).resolves.toMatchObject([
        { sourceId: 'screen:1:0' },
      ]);
      await expect(adapter.capture({ display: '20' })).resolves.toMatchObject([
        { sourceId: 'screen:0:0' },
      ]);
      expect(desktopCapturer.getSources).toHaveBeenCalledTimes(2);
    }
  );

  it('preserves the cache and selected fallback on work-area-only changes', async () => {
    const { adapter, desktopCapturer, events } = setup();
    await adapter.prepare();
    desktopCapturer.getSources.mockClear();
    events.emit('display-metrics-changed', {}, displays[0], ['workArea']);
    await adapter.capture();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    await adapter.captureFallback({}, adapter.resolveTargetDisplay({}));
    desktopCapturer.getSources.mockClear();
    events.emit('display-metrics-changed', {}, displays[0], ['workArea']);
    await expect(adapter.capture()).resolves.toMatchObject([
      { dataUrl: thumbnail.toDataURL() },
    ]);
    expect(desktopCapturer.getSources).toHaveBeenCalledExactlyOnceWith({
      types: ['screen'],
      thumbnailSize: { width: 800, height: 600 },
      fetchWindowIcons: false,
    });
  });

  it.each(['bounds', 'scaleFactor', 'rotation'])(
    'refreshes when workArea and %s both change',
    async (metric) => {
      const { adapter, desktopCapturer, events } = setup();
      await adapter.prepare();
      desktopCapturer.getSources.mockResolvedValue(swappedSources);
      events.emit('display-metrics-changed', {}, displays[0], ['workArea', metric]);
      await expect(adapter.capture()).resolves.toMatchObject([
        { sourceId: 'screen:1:0' },
      ]);
    }
  );

  it('still refreshes when prepare is explicitly called again', async () => {
    const { adapter, desktopCapturer } = setup(false);
    await adapter.prepare();
    desktopCapturer.getSources.mockResolvedValue(swappedSources);
    await adapter.prepare();
    await expect(adapter.capture()).resolves.toMatchObject([
      { sourceId: 'screen:1:0' },
    ]);
  });

  it.each([false, true])(
    'shares in-flight prewarming and discards it only after an identity change=%s',
    async (changed) => {
      const { adapter, desktopCapturer, events } = setup();
      let finish!: (sources: typeof originalSources) => void;
      desktopCapturer.getSources.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const preparing = adapter.prepare();
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      desktopCapturer.getSources.mockResolvedValue(swappedSources);
      events.emit('display-metrics-changed', {}, displays[0], [
        changed ? 'bounds' : 'workArea',
      ]);
      const capture = adapter.capture();
      finish(originalSources);
      await preparing;
      await expect(capture).resolves.toMatchObject([
        { sourceId: changed ? 'screen:1:0' : 'screen:0:0' },
      ]);
      expect(desktopCapturer.getSources).toHaveBeenCalledTimes(changed ? 2 : 1);
    }
  );

  it('never returns stale IDs after a refresh fails', async () => {
    const { adapter, desktopCapturer, events } = setup();
    await adapter.prepare();
    desktopCapturer.getSources.mockRejectedValueOnce(new Error('failed'));
    events.emit('display-added');
    await expect(adapter.capture()).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
    desktopCapturer.getSources.mockResolvedValue(swappedSources);
    await expect(adapter.capture()).resolves.toMatchObject([
      { sourceId: 'screen:1:0' },
    ]);
  });

  it('releases its subscriptions when disposed', async () => {
    const { adapter, events, desktopCapturer } = setup();
    const before = powerMonitor.listenerCount('resume');
    await adapter.prepare();
    adapter.dispose();
    expect(powerMonitor.listenerCount('resume')).toBe(before);
    expect(events.eventNames()).toEqual([]);
    desktopCapturer.getSources.mockClear();
    events.emit('display-added');
    powerMonitor.emit('resume');
    await Promise.resolve();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it.each(['anonymous', 'duplicate', 'raw-source-id'])(
    'rejects %s multi-screen identities in stream and image paths',
    async (kind) => {
      const { adapter, desktopCapturer } = setup();
      desktopCapturer.getSources.mockResolvedValue(
        kind === 'raw-source-id'
          ? [{ id: 'screen:10:0', display_id: '', thumbnail }]
          : originalSources.map((source) => ({
              ...source,
              display_id: kind === 'duplicate' ? '10' : '',
            }))
      );
      await expect(adapter.capture()).rejects.toMatchObject({
        code: 'DISPLAY_NOT_FOUND',
      });
      await expect(
        adapter.captureFallback({}, adapter.resolveTargetDisplay({}))
      ).rejects.toMatchObject({ code: 'DISPLAY_NOT_FOUND' });
    }
  );

  it('matches reversed source order by display_id in stream and image paths', async () => {
    const { adapter, desktopCapturer } = setup();
    desktopCapturer.getSources.mockResolvedValue(
      [...originalSources].reverse().map((source) => ({
        ...source,
        thumbnail: { ...thumbnail, toDataURL: () => `display-${source.display_id}` },
      }))
    );
    await expect(adapter.capture()).resolves.toMatchObject([
      { sourceId: 'screen:0:0' },
    ]);
    await expect(
      adapter.captureFallback({}, adapter.resolveTargetDisplay({}))
    ).resolves.toMatchObject([{ dataUrl: 'display-10' }]);
  });

  it('accepts one anonymous source only on a single display', async () => {
    const { adapter, desktopCapturer, screen } = setup();
    screen.getAllDisplays.mockReturnValue([displays[0]!]);
    desktopCapturer.getSources.mockResolvedValue([
      { ...originalSources[0]!, display_id: '' },
    ]);
    await expect(adapter.capture()).resolves.toMatchObject([
      { sourceId: 'screen:0:0' },
    ]);
  });
});
