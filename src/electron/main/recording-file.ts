import { open, mkdir, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Append-only recording spool. One acknowledged write at a time keeps IPC memory bounded. */
export class RecordingFile {
  readonly path: string;
  #handle: FileHandle | undefined;
  #pending: Promise<void> | undefined;
  #closed = false;
  #syncedAt = 0;
  bytes = 0;
  private constructor(path: string, handle: FileHandle) {
    this.path = path;
    this.#handle = handle;
  }

  static async create(
    directory: string,
    format: 'mp4' | 'gif'
  ): Promise<RecordingFile> {
    await mkdir(directory, { recursive: true });
    const path = join(directory, `snapora-${randomUUID()}.${format}`);
    return new RecordingFile(path, await open(path, 'wx'));
  }

  async append(data: Uint8Array, offset: number): Promise<void> {
    if (this.#closed || !this.#handle || this.#pending)
      throw new Error('Recording writer unavailable or backpressure ignored.');
    if (
      !(data instanceof Uint8Array) ||
      data.byteLength < 1 ||
      data.byteLength > 4 * 1024 * 1024 ||
      offset !== this.bytes
    )
      throw new Error('Invalid recording chunk or offset.');
    if (this.bytes + data.byteLength > 8 * 1024 ** 3)
      throw new Error('Recording exceeds the 8 GiB file limit.');
    const handle = this.#handle;
    this.#pending = (async () => {
      let written = 0;
      while (written < data.byteLength) {
        const result = await handle.write(
          data,
          written,
          data.byteLength - written,
          this.bytes
        );
        if (!result.bytesWritten)
          throw new Error('Recording disk write made no progress.');
        written += result.bytesWritten;
        this.bytes += result.bytesWritten;
      }
      if (Date.now() - this.#syncedAt >= 2000) {
        await handle.sync();
        this.#syncedAt = Date.now();
      }
    })();
    try {
      await this.#pending;
    } finally {
      this.#pending = undefined;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#pending?.catch(() => undefined);
    const handle = this.#handle;
    this.#handle = undefined;
    if (handle) {
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }

  async discard(): Promise<void> {
    await this.close();
    await unlink(this.path).catch(() => undefined);
  }
}
