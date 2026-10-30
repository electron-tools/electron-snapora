import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { NativeWindowsScreenCapture } from '../../../src/electron/main/windows-screen-capture.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', () => ({ rmSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn(async () => 'C:\\Temp\\snapora-capture-test'),
  readFile: vi.fn(async () => Buffer.from('bundled native source')),
  writeFile: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}));

/** Controllable compiler/worker pair; tests failures without starting native processes. */
function fixture() {
  const children: Array<
    EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    }
  > = [];
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit('close', 1));
        return true;
      }),
    });
    children.push(child);
    return child as unknown as ReturnType<typeof spawn>;
  });
  const worker = new NativeWindowsScreenCapture();
  const ready = async () => {
    const preparing = worker.prepare();
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]!.emit('close', 0);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1]!.stdout.write('ready\n');
    await preparing;
    return children[1]!;
  };
  return { worker, ready, children };
}

const bounds = { x: -1920, y: 100, width: 1920, height: 1080 };
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe('NativeWindowsScreenCapture', () => {
  it('skips a cancelled queued request and still executes the next valid capture', async () => {
    const { worker, ready } = fixture();
    const child = await ready();
    const requests: string[] = [];
    child.stdin.on('data', (chunk) => requests.push(String(chunk)));
    const first = worker.capture(bounds, 10000);
    const controller = new AbortController();
    const cancelled = worker.capture({ ...bounds, x: 10 }, 10000, controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const next = worker.capture({ ...bounds, x: 20 }, 10000);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort();
    child.stdout.write('iVBORw0KGgoAAA\n');
    await first;
    await rejected;
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toBe('20|100|1920|1080\n');
    child.stdout.write('iVBORw0KGgoBBB\n');
    await next;
    worker.dispose();
  });

  it('kills an active cancelled copy, ignores its late reply and restarts for the next job', async () => {
    const { worker, ready, children } = fixture();
    const old = await ready();
    const controller = new AbortController();
    const cancelled = worker.capture(bounds, 10000, controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(old.stdin.readableLength).toBeGreaterThan(0));
    controller.abort();
    old.stdout.write('iVBORw0KGgoOLD\n');
    await rejected;
    expect(old.kill).toHaveBeenCalledOnce();
    const next = worker.capture(bounds, 10000);
    await vi.waitFor(() => expect(children).toHaveLength(3));
    children[2]!.emit('close', 0);
    await vi.waitFor(() => expect(children).toHaveLength(4));
    const child = children[3]!;
    child.stdout.write('ready\n');
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0));
    old.stdout.write('iVBORw0KGgoSTALE\n');
    child.stdout.write('iVBORw0KGgoNEW\n');
    expect(await next).toBe('data:image/png;base64,iVBORw0KGgoNEW');
    worker.dispose();
  });

  it('does not read pixels when cancelled during compiler/worker warmup', async () => {
    const { worker, children } = fixture();
    const controller = new AbortController();
    const capture = worker.capture(bounds, 10000, controller.signal);
    const rejected = expect(capture).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(children).toHaveLength(1));
    controller.abort();
    children[0]!.emit('close', 0);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    children[1]!.stdout.write('ready\n');
    await rejected;
    expect(children[1]!.stdin.readableLength).toBe(0);
    worker.dispose();
  });

  it('compiles once, sends no pixels at warmup, serializes requests and assembles split replies', async () => {
    const { worker, ready } = fixture();
    const child = await ready();
    const requests: string[] = [];
    child.stdin.on('data', (chunk) => requests.push(String(chunk)));
    await worker.prepare();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(requests).toEqual([]);
    const first = worker.capture(bounds, 10000);
    const second = worker.capture(bounds, 10000);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toBe('-1920|100|1920|1080\n');
    child.stdout.write('iVBOR');
    child.stdout.write('w0KGgoAAA\n');
    expect(await first).toBe('data:image/png;base64,iVBORw0KGgoAAA');
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    child.stdout.write('iVBORw0KGgoBBB\n');
    await second;
    worker.dispose();
    await vi.waitFor(() => expect(rm).toHaveBeenCalled());
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('rejects an unavailable compiler and can be disposed during startup', async () => {
    const { worker, children } = fixture();
    const preparing = worker.prepare();
    const rejected = expect(preparing).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
    });
    await vi.waitFor(() => expect(children).toHaveLength(1));
    worker.dispose();
    await rejected;
    expect(children[0]!.kill).toHaveBeenCalled();
    await expect(worker.prepare()).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
  });

  it('rejects bounded protocol errors and recovers for the next request', async () => {
    const { worker, ready } = fixture();
    const child = await ready();
    const capture = worker.capture(bounds, 10000);
    const rejected = expect(capture).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0));
    child.stdout.write('error\n');
    await rejected;
    const next = worker.capture(bounds, 10000);
    child.stdin.read();
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0));
    child.stdout.write('iVBORw0KGgoAAA\n');
    await next;
    worker.dispose();
  });

  it('terminates oversized replies and rejects the in-flight capture on disposal', async () => {
    const { worker, ready } = fixture();
    const child = await ready();
    const capture = worker.capture(bounds, 20);
    const rejected = expect(capture).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0));
    child.stdout.write('x'.repeat(21));
    await rejected;
    expect(child.kill).toHaveBeenCalled();
    worker.dispose();
  });

  it('bounds a hung native capture and rejects non-integer geometry before sending it', async () => {
    const { worker, ready } = fixture();
    const child = await ready();
    await expect(worker.capture({ ...bounds, x: 0.5 }, 100)).rejects.toMatchObject({
      code: 'CAPTURE_FAILED',
    });
    vi.useFakeTimers();
    const capture = worker.capture(bounds, 100);
    const rejected = expect(capture).rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    expect(child.kill).toHaveBeenCalled();
    worker.dispose();
  });
});
