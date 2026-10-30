import { screen } from 'electron';
import type { ScreenshotSnapContext, ScreenshotSnapRegion } from '../../types.js';
import { MacNativeWorker, type MacNativeClient } from './mac-native-worker.js';
import {
  filterSnapRegions,
  type SnapCandidate,
  type SnapGranularity,
} from './snap-policy.js';

/** Permission state of the actual helper, which may differ from the Electron host's TCC identity. */
export interface MacSnapPermissions {
  screenRecording: boolean;
  accessibility: boolean;
}
/** Geometry-only stage counts help distinguish native traversal from panel filtering. */
interface MacSnapNativeDiagnostics {
  visibleWindows?: number;
  filteredWindows?: number;
  axTargets?: number;
  matchedWindows?: number;
  rawContainers?: number;
}
/** Configure a prebuilt helper; permission prompts remain explicit host actions. */
export interface MacSnapProviderOptions {
  executablePath?: string;
  granularity?: SnapGranularity;
  timeoutMs?: number;
  onDiagnostic?: (event: {
    durationMs: number;
    windows: number;
    containers: number;
    accessibility?: boolean;
    native?: MacSnapNativeDiagnostics;
    error?: string;
  }) => void;
}

/** CG/AX already use global DIP. Clip each candidate without applying Retina scale a second time. */
export function resolveMacSnapCandidates(
  raw: unknown,
  displays: Array<{
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>
): SnapCandidate[] {
  if (!Array.isArray(raw)) return [];
  const result: SnapCandidate[] = [];
  for (const item of raw.slice(0, 4096)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as SnapCandidate;
    if (
      ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
      r.width <= 0 ||
      r.height <= 0 ||
      !Number.isSafeInteger(r.windowZOrder) ||
      r.windowZOrder! < 0 ||
      !Number.isSafeInteger(r.sourceProcessId) ||
      r.sourceProcessId! <= 0 ||
      !['window', 'container'].includes(r.kind ?? '')
    )
      continue;
    for (const display of displays) {
      const d = display.bounds;
      const x = Math.max(d.x, r.x),
        y = Math.max(d.y, r.y);
      const right = Math.min(d.x + d.width, r.x + r.width),
        bottom = Math.min(d.y + d.height, r.y + r.height);
      if (right <= x || bottom <= y) continue;
      result.push({
        x,
        y,
        width: right - x,
        height: bottom - y,
        displayId: String(display.id),
        kind: r.kind!,
        windowZOrder: r.windowZOrder!,
        sourceProcessId: r.sourceProcessId!,
        ...(typeof r.controlType === 'string' ? { controlType: r.controlType } : {}),
      });
    }
  }
  return result;
}

/** Streams window bounds before bounded AX traversal; inaccessible apps retain window/free selection. */
export function createMacSnapProvider(
  options: MacSnapProviderOptions = {},
  client: MacNativeClient = new MacNativeWorker(options.executablePath)
) {
  let active = false;
  let disposed = false;
  const provider = async (
    signal: AbortSignal,
    onUpdate?: (regions: ScreenshotSnapRegion[]) => void,
    granularityOrContext:
      SnapGranularity | ScreenshotSnapContext = options.granularity ?? 'panel',
    context?: ScreenshotSnapContext
  ): Promise<ScreenshotSnapRegion[]> => {
    const granularity =
      typeof granularityOrContext === 'string'
        ? granularityOrContext
        : (options.granularity ?? 'panel');
    context = typeof granularityOrContext === 'string' ? context : granularityOrContext;
    if (!['window', 'panel', 'fine'].includes(granularity))
      throw new Error('Invalid snap granularity.');
    if (process.platform !== 'darwin' || disposed || signal.aborted) return [];
    if (active) throw new Error('macOS snap provider is already querying.');
    const started = Date.now();
    const displays = screen.getAllDisplays();
    active = true;
    const candidates: SnapCandidate[] = [];
    const keys = new Set<string>();
    let accessibility: boolean | undefined;
    let native: MacSnapNativeDiagnostics | undefined;
    let error: string | undefined;
    try {
      const response = await client.request(
        {
          command: 'probe',
          containers: granularity !== 'window',
          excludedWindowIds: context?.excludedWindowIds ?? [],
          cursor: screen.getCursorScreenPoint(),
        },
        {
          signal,
          timeoutMs: options.timeoutMs ?? 5000,
          onEvent: (event) => {
            if (signal.aborted || disposed) return;
            for (const r of resolveMacSnapCandidates(event.regions, displays)) {
              const key = `${r.displayId}:${r.windowZOrder}:${r.x}:${r.y}:${r.width}:${r.height}`;
              if (keys.has(key) || candidates.length >= 4096) continue;
              keys.add(key);
              candidates.push(r);
            }
            onUpdate?.(filterSnapRegions(candidates, granularity));
          },
        }
      );
      accessibility = response.accessibility === true;
      if (response.diagnostics && typeof response.diagnostics === 'object') {
        const raw = response.diagnostics as Record<string, unknown>;
        native = {};
        for (const key of [
          'visibleWindows',
          'filteredWindows',
          'axTargets',
          'matchedWindows',
          'rawContainers',
        ] as const) {
          const value = raw[key];
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
            native[key] = value;
        }
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      active = false;
    }
    const regions =
      signal.aborted || disposed ? [] : filterSnapRegions(candidates, granularity);
    try {
      options.onDiagnostic?.({
        durationMs: Date.now() - started,
        windows: regions.filter((r) => r.kind === 'window').length,
        containers: regions.filter((r) => r.kind === 'container').length,
        ...(accessibility === undefined ? {} : { accessibility }),
        ...(native ? { native } : {}),
        ...(error ? { error } : {}),
      });
    } catch {
      /* Diagnostic observers do not affect selection. */
    }
    return regions;
  };
  provider.prepare = () => client.prepare();
  provider.getPermissions = async (prompt = false): Promise<MacSnapPermissions> => {
    const response = await client.request(
      { command: 'permissions', prompt },
      { timeoutMs: prompt ? 60000 : 5000 }
    );
    return {
      screenRecording: response.screenRecording === true,
      accessibility: response.accessibility === true,
    };
  };
  provider.dispose = () => {
    disposed = true;
    client.dispose();
  };
  return provider;
}
