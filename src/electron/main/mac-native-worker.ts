import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { ScreenshotError } from './errors.js';

/** Bounded JSON-lines transport; separate instances isolate AX latency from pixel capture. */
export interface MacNativeClient {
  prepare(): Promise<void>;
  request(
    command: Record<string, unknown>,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      maxBytes?: number;
      onEvent?: (event: Record<string, unknown>) => void;
    }
  ): Promise<Record<string, unknown>>;
  dispose(): void;
}

/** Launches a prebuilt helper at a stable path. No shell, runtime compiler, or permission prompt at warmup. */
export class MacNativeWorker implements MacNativeClient {
  readonly #path: string;
  #child: ChildProcessWithoutNullStreams | undefined;
  #ready: Promise<void> | undefined;
  #rejectStartup: ((error: Error) => void) | undefined;
  #startupTimer: ReturnType<typeof setTimeout> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #disposed = false;
  #sequence = 0;
  #lineChunks: string[] = [];
  #received = 0;
  #pending:
    | {
        id: number;
        limit: number;
        event?: (event: Record<string, unknown>) => void;
        resolve: (value: Record<string, unknown>) => void;
        reject: (error: Error) => void;
        cleanup: () => void;
      }
    | undefined;
  readonly #exit = () => this.#child?.kill('SIGKILL');

  constructor(executablePath?: string) {
    const bundled = join(__dirname, '..', 'native', 'snapora-macos');
    this.#path =
      executablePath ?? bundled.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
    if (!isAbsolute(this.#path)) throw new Error('macOS helper path must be absolute.');
  }

  prepare(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('macOS helper is disposed.'));
    if (process.platform !== 'darwin')
      return Promise.reject(
        new ScreenshotError('UNSUPPORTED_PLATFORM', 'macOS helper requires macOS 14+.')
      );
    if (this.#ready) return this.#ready;
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#rejectStartup = reject;
      const child = spawn(this.#path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.#child = child;
      this.#lineChunks = [];
      this.#received = 0;
      process.removeListener('exit', this.#exit);
      process.once('exit', this.#exit);
      this.#startupTimer = setTimeout(
        () => this.#stop(new Error('macOS helper startup timed out.')),
        5000
      );
      const fail = () => {
        if (this.#child !== child) return;
        this.#stop(
          new ScreenshotError(
            'CAPTURE_FAILED',
            'macOS helper unavailable. Build it with pnpm run build:native:mac and include the signed executable in the app.'
          )
        );
      };
      child.on('error', fail);
      child.on('close', fail);
      child.stdin.on('error', fail);
      child.stderr.resume();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (this.#child !== child) return;
        this.#received += Buffer.byteLength(chunk);
        if (this.#received > (this.#pending?.limit ?? 4096)) {
          this.#stop(new Error('macOS helper response exceeded its limit.'));
          return;
        }
        // PNG replies are long single lines: scan only the new bytes and join once per line.
        let offset = 0;
        let newline: number;
        while ((newline = chunk.indexOf('\n', offset)) >= 0) {
          this.#lineChunks.push(chunk.slice(offset, newline));
          const line = this.#lineChunks.join('');
          this.#lineChunks = [];
          offset = newline + 1;
          let packet: Record<string, unknown>;
          try {
            packet = JSON.parse(line) as Record<string, unknown>;
            if (!packet || typeof packet !== 'object')
              throw new Error('Invalid packet');
          } catch {
            this.#stop(new Error('Invalid macOS helper response.'));
            return;
          }
          if (packet.type === 'ready') {
            clearTimeout(this.#startupTimer);
            this.#rejectStartup = undefined;
            resolve();
            continue;
          }
          const pending = this.#pending;
          if (!pending || packet.id !== pending.id) continue;
          if (packet.type === 'event') {
            try {
              pending.event?.(packet);
            } catch {
              /* Observers cannot break worker cleanup. */
            }
            if (this.#child !== child) return;
          } else if (packet.type === 'result' || packet.type === 'error') {
            this.#pending = undefined;
            pending.cleanup();
            if (packet.type === 'error') {
              const code =
                packet.code === 'PERMISSION_DENIED'
                  ? 'PERMISSION_DENIED'
                  : packet.code === 'DISPLAY_NOT_FOUND'
                    ? 'DISPLAY_NOT_FOUND'
                    : 'CAPTURE_FAILED';
              pending.reject(
                new ScreenshotError(
                  code,
                  typeof packet.message === 'string'
                    ? packet.message
                    : 'macOS native request failed.'
                )
              );
            } else pending.resolve(packet);
          }
        }
        if (offset < chunk.length) this.#lineChunks.push(chunk.slice(offset));
      });
    });
    return this.#ready;
  }

  request(
    command: Record<string, unknown>,
    options: Parameters<MacNativeClient['request']>[1] = {}
  ): Promise<Record<string, unknown>> {
    const result = this.#queue.then(async () => {
      options.signal?.throwIfAborted();
      const abortStartup = () =>
        this.#stop(new DOMException('Request cancelled.', 'AbortError'));
      options.signal?.addEventListener('abort', abortStartup, { once: true });
      try {
        await this.prepare();
      } finally {
        options.signal?.removeEventListener('abort', abortStartup);
      }
      options.signal?.throwIfAborted();
      if (!this.#child || this.#disposed) throw new Error('macOS helper unavailable.');
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = ++this.#sequence;
        const abort = () =>
          this.#stop(new DOMException('Request cancelled.', 'AbortError'));
        const timer = setTimeout(
          () => this.#stop(new Error('macOS native request timed out.')),
          options.timeoutMs ?? 5000
        );
        this.#received = 0;
        this.#pending = {
          id,
          limit: options.maxBytes ?? 2 * 1024 * 1024,
          resolve,
          reject,
          ...(options.onEvent ? { event: options.onEvent } : {}),
          cleanup: () => {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
          },
        };
        options.signal?.addEventListener('abort', abort, { once: true });
        this.#child!.stdin.write(JSON.stringify({ ...command, id }) + '\n');
      });
    });
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #stop(error: Error): void {
    const child = this.#child;
    this.#child = undefined;
    this.#ready = undefined;
    clearTimeout(this.#startupTimer);
    this.#rejectStartup?.(error);
    this.#rejectStartup = undefined;
    const pending = this.#pending;
    this.#pending = undefined;
    this.#lineChunks = [];
    pending?.cleanup();
    // Kill before releasing the queue; detached output/close events cannot affect a new worker.
    child?.kill('SIGKILL');
    pending?.reject(error);
    process.removeListener('exit', this.#exit);
  }

  dispose(): void {
    this.#disposed = true;
    this.#stop(new Error('macOS helper disposed.'));
  }
}
