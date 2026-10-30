import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { env, platform } from 'node:process';
import { screen } from 'electron';
import type { ScreenshotSnapRegion } from '../../types.js';
import {
  filterWindowsSnapRegions,
  type WindowsSnapCandidate,
  type WindowsSnapGranularity,
} from './windows-snap-policy.js';

export interface WindowsSnapDiagnostic {
  granularity: WindowsSnapGranularity;
  status: 'completed' | 'timeout' | 'failed' | 'cancelled';
  durationMs: number;
  /** Time until fresh Win32 bounds were available, including any worker startup. */
  windowsReadyMs?: number;
  firstContainerMs?: number;
  warm: boolean;
  windows: number;
  containers: number;
}

export interface WindowsSnapProviderOptions {
  granularity?: WindowsSnapGranularity;
  /** Includes startup; a hung UIA worker is killed at this deadline. */
  timeoutMs?: number;
  /** Reuse the isolated worker between captures. Call prepare() at app readiness and dispose() on quit. */
  keepAlive?: boolean;
  onDiagnostic?: (event: WindowsSnapDiagnostic) => void;
}

type Status = WindowsSnapDiagnostic['status'];
type Update = (regions: ScreenshotSnapRegion[]) => void;
interface Worker {
  child: ChildProcessWithoutNullStreams;
  ready: boolean;
  prepared: Promise<boolean>;
  resolveReady: (ready: boolean) => void;
  startupTimer?: ReturnType<typeof setTimeout>;
  consume?: (raw: Record<string, unknown>) => void;
}

/** Isolated, reusable UIA worker. Streams fresh bounds before slower container discovery. */
export function createWindowsSnapProvider(options: WindowsSnapProviderOptions = {}) {
  const defaultGranularity = options.granularity ?? 'panel';
  validateGranularity(defaultGranularity);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 15_000) {
    throw new RangeError('Windows snap timeoutMs must be between 100 and 15000.');
  }
  let worker: Worker | undefined;
  let active: { finish: (status: Status) => void } | undefined;
  let disposed = false;

  const stop = (target: Worker, status: Status) => {
    if (worker !== target) return;
    worker = undefined;
    clearTimeout(target.startupTimer);
    target.resolveReady(false);
    target.child.kill();
    active?.finish(status);
  };
  const ensureWorker = (): Worker => {
    if (worker) return worker;
    const child = spawn(
      join(
        env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-MTA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(__dirname, '..', 'native', 'windows-snap.ps1'),
        '-Server',
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let resolveReady!: (ready: boolean) => void;
    const prepared = new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    });
    const target: Worker = { child, ready: false, prepared, resolveReady };
    worker = target;
    target.startupTimer = setTimeout(() => stop(target, 'timeout'), timeoutMs);
    let pending = '';
    child.stderr.resume();
    child.stdin.on('error', () => stop(target, 'failed'));
    child.on('error', () => stop(target, 'failed'));
    child.on('close', () => stop(target, 'failed'));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (worker !== target) return;
      pending += chunk;
      if (pending.length > 1_000_000) {
        stop(target, 'failed');
        return;
      }
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse(line);
        } catch {
          continue;
        }
        if (!raw || typeof raw !== 'object') continue;
        if (raw.ready === true) {
          target.ready = true;
          clearTimeout(target.startupTimer);
          target.resolveReady(true);
        } else {
          target.consume?.(raw);
        }
      }
    });
    return target;
  };

  const provider = (
    signal: AbortSignal,
    onUpdate?: Update,
    granularity = defaultGranularity
  ): Promise<ScreenshotSnapRegion[]> => {
    validateGranularity(granularity);
    if (platform !== 'win32' || signal.aborted || disposed) return Promise.resolve([]);
    if (active)
      return Promise.reject(new Error('Windows snap provider is already capturing.'));
    const started = Date.now();
    const warm = worker?.ready ?? false;
    let target: Worker;
    try {
      target = ensureWorker();
    } catch {
      return Promise.resolve([]);
    }
    return new Promise((resolve) => {
      const regions: WindowsSnapCandidate[] = [];
      const keys = new Set<string>();
      let settled = false;
      let windowsReadyMs: number | undefined;
      let firstContainerMs: number | undefined;
      const publish = () => {
        if (settled || !onUpdate) return;
        try {
          onUpdate(filterWindowsSnapRegions(regions, granularity));
        } catch {
          /* Optional observer. */
        }
      };
      const finish = (status: Status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        delete target.consume;
        active = undefined;
        const selected =
          status === 'cancelled' ? [] : filterWindowsSnapRegions(regions, granularity);
        if (status !== 'completed' || !options.keepAlive) stop(target, status);
        try {
          options.onDiagnostic?.({
            status,
            granularity,
            durationMs: Date.now() - started,
            warm,
            ...(windowsReadyMs === undefined ? {} : { windowsReadyMs }),
            ...(firstContainerMs === undefined ? {} : { firstContainerMs }),
            windows: selected.filter((r) => r.kind === 'window').length,
            containers: selected.filter((r) => r.kind === 'container').length,
          });
        } catch {
          /* Diagnostics cannot break capture. */
        }
        resolve(selected);
      };
      const abort = () => finish('cancelled');
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      active = { finish };
      signal.addEventListener('abort', abort, { once: true });
      target.consume = (raw) => {
        if (settled) return;
        if (raw.windowsReady === true) {
          windowsReadyMs = Date.now() - started;
          publish();
          return;
        }
        if (raw.windowTiming === true) {
          publish();
          return;
        }
        if (raw.done === true) {
          publish();
          finish('completed');
          return;
        }
        try {
          if (
            regions.length >= 4096 ||
            !['window', 'container'].includes(raw.kind as string) ||
            ![
              raw.x,
              raw.y,
              raw.width,
              raw.height,
              raw.windowZOrder,
              raw.processId,
            ].every(Number.isFinite) ||
            (raw.width as number) <= 0 ||
            (raw.height as number) <= 0
          )
            return;
          // Discard fine-only wrappers before deduplication so they cannot hide an identical Pane/Group.
          if (
            granularity === 'panel' &&
            raw.kind === 'container' &&
            ['Custom', 'ListItem'].includes(raw.controlType as string)
          )
            return;
          // Use Electron's monitor-aware conversion, including negative monitor origins.
          const bounds = screen.screenToDipRect(null, {
            x: Math.round(raw.x as number),
            y: Math.round(raw.y as number),
            width: Math.round(raw.width as number),
            height: Math.round(raw.height as number),
          });
          const key = `${raw.windowZOrder}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
          if (keys.has(key)) return;
          keys.add(key);
          regions.push({
            ...bounds,
            windowZOrder: raw.windowZOrder as number,
            kind: raw.kind as 'window' | 'container',
            sourceProcessId: raw.processId as number,
            ...(typeof raw.controlType === 'string'
              ? { controlType: raw.controlType }
              : {}),
          });

          if (
            raw.kind === 'container' &&
            firstContainerMs === undefined &&
            filterWindowsSnapRegions(regions, granularity).some(
              (r) => r.kind === 'container'
            )
          ) {
            firstContainerMs = Date.now() - started;
          }
        } catch {
          /* Malformed worker records must not discard window fallback. */
        }
      };
      void target.prepared.then((ready) => {
        if (settled) return;
        if (!ready) {
          finish('failed');
          return;
        }
        target.child.stdin.write(granularity + '\n');
      });
    });
  };
  return Object.assign(provider, {
    /** Warm the worker without querying application content. Failure falls back on the next capture. */
    async prepare(): Promise<boolean> {
      if (platform !== 'win32' || disposed) return false;
      try {
        return await ensureWorker().prepared;
      } catch {
        return false;
      }
    },
    /** Permanently release this provider, including any in-flight native query. */
    dispose(): void {
      disposed = true;
      if (worker) stop(worker, 'cancelled');
    },
  });
}

function validateGranularity(value: WindowsSnapGranularity): void {
  if (!['window', 'panel', 'fine'].includes(value)) {
    throw new TypeError('Windows snap granularity must be window, panel or fine.');
  }
}
