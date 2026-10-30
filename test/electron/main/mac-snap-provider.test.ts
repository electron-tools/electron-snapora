import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from 'electron';
import {
  createMacSnapProvider,
  resolveMacSnapCandidates,
} from '../../../src/electron/main/mac-snap-provider.js';
import type { MacNativeClient } from '../../../src/electron/main/mac-native-worker.js';
import type { ScreenshotManagerOptions } from '../../../src/electron/main/screenshot-manager.js';
import { filterSnapRegions } from '../../../src/electron/main/snap-policy.js';

vi.mock('electron', () => ({
  screen: { getAllDisplays: vi.fn(), getCursorScreenPoint: vi.fn() },
}));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const displays = [
  { id: 1, bounds: { x: -800, y: -200, width: 800, height: 600 }, scaleFactor: 2 },
  { id: 2, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 1 },
];
const window = {
  x: -400,
  y: 20,
  width: 900,
  height: 360,
  kind: 'window',
  sourceProcessId: 42,
  windowZOrder: 0,
};
const pane = { ...window, kind: 'container', x: 20, width: 200, controlType: 'Pane' };
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  vi.mocked(screen.getAllDisplays).mockReturnValue(displays as never);
  vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: -300, y: 100 });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.clearAllMocks();
});

describe('macOS AX provider', () => {
  it('reports native stage counts separately from retained panels, without passing through arbitrary metadata', async () => {
    const diagnostic = vi.fn();
    const client: MacNativeClient = {
      prepare: vi.fn(async () => {}),
      dispose: vi.fn(),
      request: vi.fn(async (_command, options) => {
        options?.onEvent?.({ regions: [window] });
        return {
          accessibility: true,
          diagnostics: {
            visibleWindows: 26,
            filteredWindows: 10,
            axTargets: 5,
            matchedWindows: 4,
            rawContainers: 18,
            title: 'must not pass through',
          },
        };
      }),
    };
    const provider = createMacSnapProvider({ onDiagnostic: diagnostic }, client);
    await provider(new AbortController().signal);
    expect(diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        windows: 2,
        containers: 0,
        accessibility: true,
        native: {
          visibleWindows: 26,
          filteredWindows: 10,
          axTargets: 5,
          matchedWindows: 4,
          rawContainers: 18,
        },
      })
    );
    provider.dispose();
  });

  it('sends fresh global DIP pointer coordinates on every query without changing candidate z-order', async () => {
    const client: MacNativeClient = {
      prepare: vi.fn(async () => {}),
      dispose: vi.fn(),
      request: vi.fn(async (_command, options) => {
        options?.onEvent?.({ regions: [window] });
        return { accessibility: true };
      }),
    };
    const provider = createMacSnapProvider({}, client);
    const signal = new AbortController().signal;
    expect((await provider(signal)).every((r) => r.windowZOrder === 0)).toBe(true);
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { x: -300, y: 100 } }),
      expect.any(Object)
    );
    vi.mocked(screen.getCursorScreenPoint).mockReturnValue({ x: 500, y: 200 });
    await provider(signal);
    expect(client.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { x: 500, y: 200 } }),
      expect.any(Object)
    );
    provider.dispose();
  });
  it('clips point-space rectangles per display without multiplying Retina scale or flipping Y', () => {
    const result = resolveMacSnapCandidates(
      [window, { ...window, width: NaN }, { ...window, windowZOrder: -1 }],
      displays
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      displayId: '1',
      x: -400,
      y: 20,
      width: 400,
      height: 360,
    });
    expect(result[1]).toMatchObject({
      displayId: '2',
      x: 0,
      y: 20,
      width: 500,
      height: 360,
    });
    const all = [
      ...result,
      ...resolveMacSnapCandidates(
        [
          pane,
          { ...pane, controlType: 'ListItem', x: 30, y: 40, width: 80, height: 60 },
        ],
        displays
      ),
    ];
    expect(filterSnapRegions(all, 'window')).toHaveLength(2);
    expect(filterSnapRegions(all, 'panel')).toHaveLength(3);
    expect(filterSnapRegions(all, 'fine')).toHaveLength(4);
  });

  it('streams windows first, accepts manager context directly and retains partial results on AX timeout', async () => {
    const client: MacNativeClient = {
      prepare: vi.fn(async () => {}),
      dispose: vi.fn(),
      request: vi.fn(async (_command, options) => {
        options?.onEvent?.({ regions: [window] });
        options?.onEvent?.({ regions: [pane, pane] });
        throw new Error('AX timeout');
      }),
    };
    const provider = createMacSnapProvider({}, client);
    const compatible: NonNullable<ScreenshotManagerOptions['getWindowSnapRegions']> =
      provider;
    const updates = vi.fn();
    const result = await compatible(new AbortController().signal, updates, {
      excludedWindowHandles: [],
      excludedWindowIds: ['99'],
    });
    expect(updates.mock.calls[0]![0]).toHaveLength(2);
    expect(result).toHaveLength(3);
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({ excludedWindowIds: ['99'], containers: true }),
      expect.any(Object)
    );
    provider.dispose();
    expect(client.dispose).toHaveBeenCalledOnce();
  });

  it('never publishes aborted results, and permission prompting is explicit', async () => {
    const abort = new AbortController();
    const client: MacNativeClient = {
      prepare: vi.fn(async () => {}),
      dispose: vi.fn(),
      request: vi.fn(async (command, options) => {
        if (command.command === 'probe') {
          abort.abort();
          options?.onEvent?.({ regions: [window] });
        }
        return { accessibility: false, screenRecording: true };
      }),
    };
    const provider = createMacSnapProvider({}, client),
      update = vi.fn();
    await provider.prepare();
    expect(client.request).not.toHaveBeenCalled();
    expect(await provider(abort.signal, update)).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    expect(await provider.getPermissions()).toEqual({
      accessibility: false,
      screenRecording: true,
    });
    expect(client.request).toHaveBeenLastCalledWith(
      { command: 'permissions', prompt: false },
      expect.any(Object)
    );
    await provider.getPermissions(true);
    expect(client.request).toHaveBeenLastCalledWith(
      { command: 'permissions', prompt: true },
      expect.any(Object)
    );
    provider.dispose();
  });
});
