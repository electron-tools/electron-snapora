import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolveNativeHelperPath } from './resource-paths.js';
import type { NativeRecordingPacket } from '../../recording/protocol.js';

/** Pull-based compressed-video bridge. Three native credits bound data without losing encoded dependencies. */
export class MacRecordingSource {
  #child: ChildProcessWithoutNullStreams;
  #buffer = '';
  #id = 0;
  #pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #packets: NativeRecordingPacket[] = [];
  #waiting:
    | { resolve: (p: NativeRecordingPacket | null) => void; reject: (e: Error) => void }
    | undefined;
  #ended = false;
  #disposed = false;
  #error: Error | undefined;
  #ready: Promise<void>;
  #exit = () => this.dispose();

  constructor() {
    this.#child = spawn(resolveNativeHelperPath('snapora-macos-recording'), [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#child.stderr.resume();
    this.#child.stdout.setEncoding('utf8');
    this.#ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.#fail(
            new Error(
              'macOS recording helper startup timed out. Rebuild with build:native:mac.'
            )
          ),
        5000
      );
      this.#pending.set(0, { resolve: () => resolve(), reject, timer });
    });
    this.#child.on('error', (e) => this.#fail(e));
    this.#child.stdin.on('error', (e) => this.#fail(e));
    this.#child.on('exit', () => {
      if (!this.#disposed) this.#fail(new Error('macOS recording helper exited.'));
    });
    this.#child.stdout.on('data', (chunk: string) => {
      this.#buffer += chunk;
      if (this.#buffer.length > 12 * 1024 * 1024)
        return this.#fail(new Error('Native recording response limit exceeded.'));
      let index: number;
      while ((index = this.#buffer.indexOf('\n')) >= 0) {
        const line = this.#buffer.slice(0, index);
        this.#buffer = this.#buffer.slice(index + 1);
        try {
          this.#message(JSON.parse(line) as Record<string, unknown>);
        } catch (error) {
          this.#fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    process.once('exit', this.#exit);
  }

  #message(m: Record<string, unknown>) {
    if (m.type === 'packet') {
      if (
        !Number.isInteger(m.sequence) ||
        !Number.isFinite(m.timestamp) ||
        !Number.isFinite(m.duration) ||
        typeof m.data !== 'string' ||
        typeof m.config !== 'string' ||
        typeof m.key !== 'boolean'
      )
        throw new Error('Malformed native video packet.');
      const packet: NativeRecordingPacket = {
        sequence: Number(m.sequence),
        timestamp: Number(m.timestamp),
        duration: Number(m.duration),
        key: m.key,
        data: new Uint8Array(Buffer.from(m.data, 'base64')),
        config: new Uint8Array(Buffer.from(m.config, 'base64')),
      };
      if (
        packet.config.length < 4 ||
        packet.data.length > 4 * 1024 * 1024 ||
        this.#packets.length >= 3
      )
        throw new Error('Native recording exceeded bounded queue.');
      if (this.#waiting) {
        this.#waiting.resolve(packet);
        this.#waiting = undefined;
      } else this.#packets.push(packet);
      return;
    }
    if (m.type === 'fatal') throw new Error(String(m.message));
    const id = m.type === 'ready' ? 0 : Number(m.id);
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    if (m.type === 'error') pending.reject(new Error(String(m.message)));
    else if (id === 0 && m.protocolVersion !== 1)
      pending.reject(new Error('Unsupported native recording protocol.'));
    else pending.resolve(m.value);
  }

  async command(
    command: string,
    payload: Record<string, unknown> = {}
  ): Promise<unknown> {
    await this.#ready;
    if (this.#error || this.#disposed)
      throw this.#error ?? new Error('Native recording source closed.');
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.#fail(new Error(`Native recording ${command} timed out.`)),
        15000
      );
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(JSON.stringify({ ...payload, command, id }) + '\n');
    });
  }

  next(sequence?: number): Promise<NativeRecordingPacket | null> {
    if (this.#error || this.#disposed)
      return Promise.reject(
        this.#error ?? new Error('Native recording source closed.')
      );
    if (sequence !== undefined)
      this.#child.stdin.write(
        JSON.stringify({ id: -1, command: 'ack', sequence }) + '\n'
      );
    const packet = this.#packets.shift();
    if (packet) return Promise.resolve(packet);
    if (this.#ended) return Promise.resolve(null);
    if (this.#waiting)
      return Promise.reject(new Error('Only one native video reader is allowed.'));
    return new Promise((resolve, reject) => {
      this.#waiting = { resolve, reject };
    });
  }

  async stop() {
    await this.command('stop');
    this.#ended = true;
    if (!this.#packets.length && this.#waiting) {
      this.#waiting.resolve(null);
      this.#waiting = undefined;
    }
  }

  #fail(error: Error) {
    this.#error = error;
    this.dispose();
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(this.#error ?? new Error('Native recording disposed.'));
    }
    this.#pending.clear();
    this.#waiting?.reject(this.#error ?? new Error('Native recording disposed.'));
    this.#waiting = undefined;
    this.#packets = [];
    this.#child.kill();
    process.removeListener('exit', this.#exit);
  }
}
