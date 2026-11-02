import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { RecordingFile } from '../../src/electron/main/recording-file.js';

describe('recording spool', () => {
  it('writes in order, rejects replays/oversized chunks, and closes with bytes intact', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snapora-writer-'));
    try {
      const file = await RecordingFile.create(dir, 'mp4');
      await file.append(new Uint8Array([1, 2, 3]), 0);
      await expect(file.append(new Uint8Array([9]), 0)).rejects.toThrow('offset');
      await expect(
        file.append(new Uint8Array(4 * 1024 * 1024 + 1), 3)
      ).rejects.toThrow();
      await file.append(new Uint8Array([4, 5]), 3);
      await file.close();
      expect([...(await readFile(file.path))]).toEqual([1, 2, 3, 4, 5]);
      await expect(file.append(new Uint8Array([6]), 5)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('does not permit concurrent writes and drains before discarding', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'snapora-writer-'));
    try {
      const file = await RecordingFile.create(dir, 'gif');
      const write = file.append(new Uint8Array(1024 * 1024), 0);
      await expect(file.append(new Uint8Array([1]), 0)).rejects.toThrow('backpressure');
      await write;
      await file.discard();
      await expect(readFile(file.path)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
