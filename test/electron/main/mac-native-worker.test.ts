import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MacNativeWorker } from '../../../src/electron/main/mac-native-worker.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** Fake native transport verifies process lifetime and framing without macOS permissions. */
function fixture() {
  const children: Array<ReturnType<typeof child>> = [];
  function child() {
    const value = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    return value;
  }
  vi.mocked(spawn).mockImplementation(() => {
    const value = child();
    children.push(value);
    return value as never;
  });
  const worker = new MacNativeWorker();
  const ready = async () => {
    const pending = worker.prepare();
    const c = children.at(-1)!;
    c.stdout.write('{"type":"ready"}\n');
    await pending;
    return c;
  };
  const nextRequest = async (c: ReturnType<typeof child>) => {
    await vi.waitFor(() => expect(c.stdin.readableLength).toBeGreaterThan(0));
    return JSON.parse(c.stdin.read().toString()) as { id: number; command: string };
  };
  return { worker, children, ready, nextRequest };
}

describe('macOS native transport', () => {
  it('receives a large fragmented PNG with linear delimiter scanning and completes only at newline', async () => {
    const f = fixture();
    const c = await f.ready();
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024);
    const result = f.worker.request(
      { command: 'capture' },
      { maxBytes: dataUrl.length + 1024 }
    );
    const request = await f.nextRequest(c);
    const payload = JSON.stringify({ id: request.id, type: 'result', dataUrl });
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    let scanned = 0;
    const original = String.prototype.indexOf;
    // Measure search work rather than wall time, so the regression is stable on slow CI hosts.
    const scan = vi.spyOn(String.prototype, 'indexOf').mockImplementation(function (
      this: string,
      search: string,
      offset = 0
    ) {
      if (search === '\n') scanned += Math.max(0, this.length - offset);
      return original.call(this, search, offset);
    });
    try {
      for (let offset = 0; offset < payload.length; offset += 65536)
        c.stdout.write(payload.slice(offset, offset + 65536));
      await Promise.resolve();
      expect(settled).toBe(false);
      c.stdout.write('\n');
      expect((await result).dataUrl).toBe(dataUrl);
    } finally {
      scan.mockRestore();
      f.worker.dispose();
    }
    expect(scanned).toBeLessThanOrEqual((payload.length + 1) * 2);
  });

  it('enforces the cumulative byte limit before an unfinished line completes', async () => {
    const f = fixture();
    const c = await f.ready();
    const pending = f.worker.request({ command: 'capture' }, { maxBytes: 100 });
    const failed = expect(pending).rejects.toThrow(/exceeded/);
    await f.nextRequest(c);
    c.stdout.write('A'.repeat(60));
    c.stdout.write('B'.repeat(41));
    await failed;
    expect(c.kill).toHaveBeenCalledOnce();
    f.worker.dispose();
  });
  it('cancels during startup without issuing a pixel command', async () => {
    const f = fixture();
    const controller = new AbortController();
    const result = f.worker.request(
      { command: 'capture' },
      { signal: controller.signal }
    );
    const failed = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(f.children).toHaveLength(1));
    controller.abort();
    await failed;
    expect(f.children[0]!.stdin.readableLength).toBe(0);
    expect(f.children[0]!.kill).toHaveBeenCalledOnce();
    f.worker.dispose();
  });
  it('prepares without commands, parses split streamed replies and reuses the helper', async () => {
    const f = fixture();
    const c = await f.ready();
    expect(c.stdin.readableLength).toBe(0);
    const update = vi.fn();
    const result = f.worker.request({ command: 'probe' }, { onEvent: update });
    const request = await f.nextRequest(c);
    c.stdout.write(`{"id":${request.id},"type":"eve`);
    c.stdout.write(
      `nt","regions":[]}\n{"id":${request.id},"type":"result","accessibility":true}\n`
    );
    expect(await result).toMatchObject({ accessibility: true });
    expect(update).toHaveBeenCalledOnce();
    await f.worker.prepare();
    expect(spawn).toHaveBeenCalledOnce();
    f.worker.dispose();
  });

  it('skips cancelled queued work and kills active work before restarting; ignores old replies', async () => {
    const f = fixture();
    const old = await f.ready();
    const active = new AbortController(),
      queued = new AbortController();
    const first = f.worker.request({ command: 'capture' }, { signal: active.signal });
    const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = f.worker.request(
      { command: 'cancelled' },
      { signal: queued.signal }
    );
    const secondRejected = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    const oldRequest = await f.nextRequest(old);
    old.stdout.write(`{"type":"result","id":${oldRequest.id},"partial":"`);
    queued.abort();
    active.abort();
    await firstRejected;
    await secondRejected;
    expect(old.kill).toHaveBeenCalledWith('SIGKILL');
    const next = f.worker.request({ command: 'next' });
    await vi.waitFor(() => expect(f.children).toHaveLength(2));
    const current = f.children[1]!;
    current.stdout.write('{"type":"ready"}\n');
    const request = await f.nextRequest(current);
    old.stdout.write(`{"type":"result","id":${oldRequest.id},"stale":true}\n`);
    old.emit('close', 0);
    current.stdout.write(`{"type":"result","id":${request.id},"fresh":true}\n`);
    expect(await next).toMatchObject({ fresh: true });
    expect(current.kill).not.toHaveBeenCalled();
    f.worker.dispose();
  });

  it('bounds a hung startup, rejects disposal and can recover after a timeout', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.worker.prepare();
    const rejected = expect(pending).rejects.toThrow(/startup timed out/);
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    const c = await f.ready();
    const request = f.worker.request({ command: 'probe' }, { timeoutMs: 100 });
    const failed = expect(request).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(c.kill).toHaveBeenCalledOnce();
    f.worker.dispose();
    await expect(f.worker.prepare()).rejects.toThrow(/disposed/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'invalid-json\n',
    '{"type":"event","id":1,"padding":"' + 'x'.repeat(500) + '"}\n',
  ])('rejects malformed or over-budget native output', async (data) => {
    const f = fixture();
    const c = await f.ready();
    const result = f.worker.request({ command: 'probe' }, { maxBytes: 100 });
    const failed = expect(result).rejects.toThrow();
    await f.nextRequest(c);
    c.stdout.write(data);
    await failed;
    expect(c.kill).toHaveBeenCalledOnce();
    f.worker.dispose();
  });
});
