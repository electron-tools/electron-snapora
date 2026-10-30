import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScreenshotBounds } from '../../types.js';
import { ScreenshotError } from './errors.js';

/** Native process boundary: warmup compiles only; capture is serialized and bounded. */
export interface WindowsScreenCapture {
  prepare(): Promise<void>;
  capture(
    bounds: ScreenshotBounds,
    maxDataUrlBytes: number,
    signal?: AbortSignal
  ): Promise<string>;
  dispose(): void;
}

/** A separate GDI process keeps pixel copying/PNG encoding off Electron's UI threads.
 * The OS .NET Framework compiler is invoked directly, once per adapter; no PowerShell,
 * external download, shared executable cache, or screen pixels during prepare().
 */
export class NativeWindowsScreenCapture implements WindowsScreenCapture {
  #child: ChildProcessWithoutNullStreams | undefined;
  #compiler: ChildProcessWithoutNullStreams | undefined;
  #directory: string | undefined;
  #preparing: Promise<void> | undefined;
  #disposed = false;
  #pending:
    | {
        resolve: (value: string) => void;
        reject: (error: Error) => void;
        limit: number;
        timer: ReturnType<typeof setTimeout>;
        cancelled: boolean;
        cleanup: () => void;
      }
    | undefined;
  #buffer = '';
  #queue: Promise<unknown> = Promise.resolve();
  // app.quit() may finish before asynchronous child-close cleanup gets a turn.
  #exitCleanup = (): void => {
    this.#compiler?.kill();
    this.#child?.kill();
    if (this.#directory) {
      try {
        rmSync(this.#directory, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 30,
        });
      } catch {
        /* OS temp cleanup remains the last resort after a locked-file failure. */
      }
    }
  };

  prepare(): Promise<void> {
    if (this.#disposed)
      return Promise.reject(this.#error('Native capture is disposed.'));
    return (this.#preparing ??= this.#start().catch((error: unknown) => {
      this.#preparing = undefined;
      this.#child?.kill();
      this.#child = undefined;
      this.#cleanupDirectory();
      throw error;
    }));
  }

  async #start(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'snapora-capture-'));
    this.#directory = directory;
    process.removeListener('exit', this.#exitCleanup);
    process.once('exit', this.#exitCleanup);
    if (this.#disposed) throw this.#error('Native capture is disposed.');
    const executable = join(directory, 'capture.exe');
    // csc cannot read Electron's virtual app.asar paths; copy only the bundled source.
    const sourcePath = join(directory, 'capture.cs');
    await writeFile(
      sourcePath,
      await readFile(join(__dirname, '..', 'native', 'windows-capture.cs'))
    );
    if (this.#disposed) throw this.#error('Native capture is disposed.');
    await new Promise<void>((resolve, reject) => {
      const compiler = spawn(
        join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'Microsoft.NET',
          process.arch === 'ia32' ? 'Framework' : 'Framework64',
          'v4.0.30319',
          'csc.exe'
        ),
        [
          '/nologo',
          '/optimize+',
          '/r:System.Drawing.dll',
          `/out:${executable}`,
          sourcePath,
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      this.#compiler = compiler;
      const timer = setTimeout(() => {
        compiler.kill();
        reject(this.#error('Native capture compiler timed out.'));
      }, 5000);
      compiler.stdout.resume();
      compiler.stderr.resume();
      compiler.on('error', () => {
        clearTimeout(timer);
        reject(this.#error('Windows .NET Framework compiler is unavailable.'));
      });
      compiler.on('close', (code) => {
        clearTimeout(timer);
        if (this.#compiler === compiler) this.#compiler = undefined;
        if (code === 0) resolve();
        else reject(this.#error('Native capture compilation failed.'));
      });
    });
    if (this.#disposed) throw this.#error('Native capture is disposed.');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.#child = child;
      const timer = setTimeout(() => {
        child.kill();
        reject(this.#error('Native capture startup timed out.'));
      }, 3000);
      const fail = () => {
        clearTimeout(timer);
        const error = this.#error('Native capture process exited.');
        reject(error);
        if (this.#child !== child) return;
        this.#child = undefined;
        this.#preparing = undefined;
        const pending = this.#pending;
        this.#pending = undefined;
        if (pending) {
          clearTimeout(pending.timer);
          pending.cleanup();
          pending.reject(
            pending.cancelled
              ? new DOMException('Capture cancelled.', 'AbortError')
              : error
          );
        }
        this.#cleanupDirectory();
      };
      child.on('error', fail);
      child.on('close', fail);
      child.stdin.on('error', fail);
      child.stderr.resume();
      child.stdout.setEncoding('utf8');
      this.#buffer = '';
      child.stdout.on('data', (chunk: string) => {
        if (this.#child !== child) return;
        this.#buffer += chunk;
        if (this.#buffer.length > (this.#pending?.limit ?? 1024)) {
          child.kill();
          return;
        }
        const newline = this.#buffer.indexOf('\n');
        if (newline < 0) return;
        const line = this.#buffer.slice(0, newline).trimEnd();
        this.#buffer = this.#buffer.slice(newline + 1);
        if (line === 'ready') {
          clearTimeout(timer);
          resolve();
          return;
        }
        const pending = this.#pending;
        if (!pending) {
          child.kill();
          return;
        }
        // Cancellation kills this worker. Wait for close before releasing the queue so the
        // successor cannot write to a dying process or consume this request's late response.
        if (pending.cancelled) return;
        this.#pending = undefined;
        clearTimeout(pending.timer);
        pending.cleanup();
        if (line === 'error' || !line.startsWith('iVBORw0KGgo'))
          pending.reject(this.#error('Native screen copy failed.'));
        else pending.resolve(`data:image/png;base64,${line}`);
      });
    });
  }

  capture(
    bounds: ScreenshotBounds,
    maxDataUrlBytes: number,
    signal?: AbortSignal
  ): Promise<string> {
    // Check cancellation on dequeue as well as after warmup: cancelled queued jobs never read pixels.
    const result = this.#queue.then(() =>
      this.#capture(bounds, maxDataUrlBytes, signal)
    );
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #capture(
    bounds: ScreenshotBounds,
    maxDataUrlBytes: number,
    signal?: AbortSignal
  ): Promise<string> {
    signal?.throwIfAborted();
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    )
      throw this.#error('Invalid physical display bounds.');
    await this.prepare();
    signal?.throwIfAborted();
    if (this.#pending) throw this.#error('Native capture is already running.');
    if (!this.#child || this.#disposed)
      throw this.#error('Native capture is unavailable.');
    return new Promise<string>((resolve, reject) => {
      const child = this.#child!;
      const abort = () => {
        pending.cancelled = true;
        child.kill();
      };
      const pending = {
        resolve,
        reject,
        limit: maxDataUrlBytes,
        timer: setTimeout(() => child.kill(), 5000),
        cancelled: false,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      this.#pending = pending;
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.write(`${bounds.x}|${bounds.y}|${bounds.width}|${bounds.height}\n`);
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#compiler?.kill();
    this.#child?.kill();
    // Process close releases pending captures and removes the private compilation directory.
    if (!this.#compiler && !this.#child) this.#cleanupDirectory();
  }

  #cleanupDirectory(): void {
    const directory = this.#directory;
    if (directory)
      void rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      })
        .then(() => {
          if (this.#directory === directory) {
            this.#directory = undefined;
            process.removeListener('exit', this.#exitCleanup);
          }
        })
        .catch(() => undefined);
  }

  #error(message: string): ScreenshotError {
    return new ScreenshotError('CAPTURE_FAILED', message);
  }
}
