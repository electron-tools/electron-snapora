import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { screen } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWindowsSnapProvider } from '../../../src/electron/main/windows-snap-provider.js';
import type { ScreenshotManagerOptions } from '../../../src/electron/main/screenshot-manager.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:process', () => ({
  platform: 'win32',
  env: { SystemRoot: 'C:\\Windows' },
}));
vi.mock('electron', () => ({
  screen: { getAllDisplays: vi.fn(), dipToScreenRect: vi.fn() },
}));

function worker() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}
const region = {
  x: -300,
  y: 60,
  width: 600,
  height: 300,
  windowZOrder: 2,
  processId: 42,
  kind: 'window',
};

describe('Windows snapshot process boundary', () => {
  it('accepts the Manager context directly and excludes only validated native handles', async () => {
    const child = worker();
    const provider = createWindowsSnapProvider();
    const compatible: NonNullable<ScreenshotManagerOptions['getWindowSnapRegions']> =
      provider;
    const result = compatible(new AbortController().signal, undefined, {
      excludedWindowHandles: ['101', '202'],
    });
    child.stdout.write('{"ready":true}\n');
    await Promise.resolve();
    expect(child.stdin.read().toString()).toBe('panel|101,202\n');
    child.stdout.write('{"done":true}\n');
    expect(await result).toEqual([]);
    expect(() =>
      provider(new AbortController().signal, undefined, {
        excludedWindowHandles: ['1\nfine'],
      })
    ).toThrow(/handles/);
  });
  it('prewarms once, streams bounds before completion, and takes a fresh snapshot on reuse', async () => {
    const child = worker();
    const diagnostics = vi.fn();
    const provider = createWindowsSnapProvider({
      keepAlive: true,
      onDiagnostic: diagnostics,
    });
    const ready = provider.prepare();
    child.stdout.write('{"ready":true}\n');
    expect(await ready).toBe(true);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/native[/\\]snapora-windows-snap\.exe$/),
      ['--server'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const update = vi.fn();
    const first = provider(new AbortController().signal, update, 'fine');
    await Promise.resolve();
    expect(child.stdin.read().toString()).toBe('fine\n');
    child.stdout.write(JSON.stringify(region) + '\n{"windowsReady":true}\n');
    expect(update).toHaveBeenCalledWith([expect.objectContaining({ kind: 'window' })]);
    expect(diagnostics).not.toHaveBeenCalled();
    child.stdout.write('{"done":true}\n');
    expect(await first).toHaveLength(1);
    expect(child.kill).not.toHaveBeenCalled();
    const second = provider(new AbortController().signal, undefined, 'window');
    await Promise.resolve();
    expect(child.stdin.read().toString()).toBe('window\n');
    child.stdout.write('{"windowsReady":true}\n{"done":true}\n');
    expect(await second).toEqual([]);
    expect(spawn).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({ warm: true, windows: 0 })
    );
    provider.dispose();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(await provider.prepare()).toBe(false);
    expect(await provider(new AbortController().signal)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects concurrent requests and isolates a restarted worker from late output', async () => {
    const old = worker();
    const provider = createWindowsSnapProvider({ keepAlive: true, timeoutMs: 100 });
    const first = provider(new AbortController().signal);
    await expect(provider(new AbortController().signal)).rejects.toThrow(
      /already capturing/
    );
    old.stdout.write(JSON.stringify(region) + '\n');
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toHaveLength(1);
    const next = worker();
    const update = vi.fn();
    const second = provider(new AbortController().signal, update);
    old.stdout.write(JSON.stringify(region) + '\n{"done":true}\n');
    old.emit('close');
    next.stdout.write('{"ready":true}\n');
    await Promise.resolve();
    next.stdout.write('{"windowsReady":true}\n{"done":true}\n');
    expect(await second).toEqual([]);
    expect(update.mock.calls.every(([regions]) => regions.length === 0)).toBe(true);
    provider.dispose();
  });

  it('bounds failed warmup and disposal during startup without leaving a pending request', async () => {
    const child = worker();
    const provider = createWindowsSnapProvider({ keepAlive: true, timeoutMs: 100 });
    const ready = provider.prepare();
    await vi.advanceTimersByTimeAsync(100);
    expect(await ready).toBe(false);
    expect(child.kill).toHaveBeenCalledOnce();
    worker();
    const request = provider(new AbortController().signal);
    provider.dispose();
    expect(await request).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects invalid configuration before spawning a helper', () => {
    expect(() =>
      createWindowsSnapProvider({ granularity: 'buttons' as never })
    ).toThrow(/granularity/);
    expect(spawn).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(screen.getAllDisplays).mockReturnValue([
      {
        id: 1,
        scaleFactor: 1.5,
        bounds: { x: -1000, y: 0, width: 2000, height: 1500 },
      },
    ] as never);
    vi.mocked(screen.dipToScreenRect).mockImplementation((_window, r) => ({
      x: r.x * 1.5,
      y: r.y * 1.5,
      width: r.width * 1.5,
      height: r.height * 1.5,
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('parses split records, deduplicates, and converts physical pixels exactly once', async () => {
    const child = worker();
    const diagnostics = vi.fn();
    const result = createWindowsSnapProvider({ onDiagnostic: diagnostics })(
      new AbortController().signal
    );
    child.stdout.write('{"ready":true}\n');
    await Promise.resolve();
    const line = JSON.stringify(region) + '\n';
    child.stdout.write(line.slice(0, 30));
    child.stdout.write(
      line.slice(30) + line + '{"kind":"window","width":-1}\n{"done":true}\n'
    );
    child.emit('close', 0);
    expect(await result).toEqual([
      {
        displayId: '1',
        x: -200,
        y: 40,
        width: 400,
        height: 200,
        windowZOrder: 2,
        kind: 'window',
        sourceProcessId: 42,
      },
    ]);
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', windows: 1 })
    );
    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      ['--server'],
      expect.objectContaining({ windowsHide: true })
    );
  });

  it('kills a hung UIA process and retains streamed window fallback', async () => {
    const child = worker();
    const diagnostics = vi.fn();
    const result = createWindowsSnapProvider({
      timeoutMs: 500,
      onDiagnostic: diagnostics,
    })(new AbortController().signal);
    child.stdout.write('{"ready":true}\n');
    await Promise.resolve();
    child.stdout.write(JSON.stringify(region) + '\n');
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toHaveLength(1);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'timeout', containers: 0 })
    );
    child.emit('close', 1);
    expect(diagnostics).toHaveBeenCalledOnce();
  });

  it.each(['window', 'panel', 'fine'] as const)(
    'passes %s to the helper and reports the effective selection',
    async (granularity) => {
      const child = worker();
      const diagnostics = vi.fn();
      const result = createWindowsSnapProvider({
        granularity,
        onDiagnostic: diagnostics,
      })(new AbortController().signal);
      child.stdout.write('{"ready":true}\n');
      await Promise.resolve();
      child.stdout.write(
        JSON.stringify(region) +
          '\n' +
          JSON.stringify({
            ...region,
            x: -280,
            y: 80,
            width: 180,
            height: 90,
            kind: 'container',
            controlType: 'Group',
          }) +
          '\n{"done":true}\n'
      );
      child.emit('close', 0);
      expect((await result).length).toBe(granularity === 'fine' ? 2 : 1);
      expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(['--server']);
      expect(child.stdin.read().toString()).toBe(granularity + '\n');
      expect(diagnostics).toHaveBeenCalledWith(
        expect.objectContaining({
          granularity,
          containers: granularity === 'fine' ? 1 : 0,
        })
      );
    }
  );

  it('cancels discovery without retaining stale regions', async () => {
    const child = worker();
    const controller = new AbortController();
    const result = createWindowsSnapProvider()(controller.signal);
    child.stdout.write('{"ready":true}\n');
    await Promise.resolve();
    child.stdout.write(JSON.stringify(region) + '\n');
    controller.abort();
    expect(await result).toEqual([]);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a fine-only wrapper hide an identical panel during deduplication', async () => {
    const child = worker();
    const result = createWindowsSnapProvider()(new AbortController().signal);
    const container = {
      ...region,
      x: -280,
      y: 80,
      width: 300,
      height: 210,
      kind: 'container',
    };
    child.stdout.write(
      [
        region,
        { ...container, controlType: 'Custom' },
        { ...container, controlType: 'Pane' },
        { done: true },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n'
    );
    child.emit('close', 0);
    expect((await result).filter((r) => r.kind === 'container')).toEqual([
      expect.objectContaining({ displayId: '1', controlType: 'Pane' }),
    ]);
  });

  it('does not start an already cancelled task and fails closed on spawn errors', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await createWindowsSnapProvider()(controller.signal)).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
    const child = worker();
    const result = createWindowsSnapProvider()(new AbortController().signal);
    child.emit('error', new Error('missing packaged executable'));
    expect(await result).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
