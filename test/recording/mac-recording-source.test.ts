import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { MacRecordingSource } from '../../src/electron/main/mac-recording-source.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

/** Exercise packet framing, drain and failure without pretending to run ScreenCaptureKit. */
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as never);
  const source = new MacRecordingSource();
  const send = (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n');
  send({ type: 'ready', protocolVersion: 1 });
  const packet = (sequence: number) =>
    send({
      type: 'packet',
      sequence,
      timestamp: sequence / 30,
      duration: 1 / 30,
      key: sequence === 1,
      config: 'AU0AKA==',
      data: 'AQID',
    });
  const command = async () => {
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0));
    return JSON.parse(child.stdin.read().toString()) as {
      id: number;
      command: string;
      sequence?: number;
    };
  };
  return { source, child, send, packet, command };
}

describe('macOS compressed recording transport', () => {
  it('drains queued packets after native stop, then returns EOF; sends explicit credits', async () => {
    const f = fixture();
    try {
      f.packet(1);
      f.packet(2);
      expect(await f.source.next()).toMatchObject({
        sequence: 1,
        data: new Uint8Array([1, 2, 3]),
      });
      expect(await f.source.next(1)).toMatchObject({ sequence: 2 });
      expect(await f.command()).toMatchObject({ command: 'ack', sequence: 1 });
      f.packet(3);
      const stopping = f.source.stop();
      const request = await f.command();
      f.send({ id: request.id, type: 'result' });
      await stopping;
      expect(await f.source.next(2)).toMatchObject({ sequence: 3 });
      expect(await f.source.next(3)).toBeNull();
    } finally {
      f.source.dispose();
    }
  });

  it('rejects a blocked reader when the native process fails and releases the child', async () => {
    const f = fixture();
    const read = expect(f.source.next()).rejects.toThrow('filter failed');
    f.send({ type: 'fatal', message: 'filter failed' });
    await read;
    expect(f.child.kill).toHaveBeenCalledOnce();
    await expect(f.source.next()).rejects.toThrow('filter failed');
  });

  it('fails closed on packet overflow rather than silently dropping H.264 dependencies', async () => {
    const f = fixture();
    f.packet(1);
    f.packet(2);
    f.packet(3);
    f.packet(4);
    await expect(f.source.next()).rejects.toThrow('bounded queue');
    expect(f.child.kill).toHaveBeenCalledOnce();
  });
});
