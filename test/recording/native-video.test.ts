import { describe, expect, it, vi } from 'vitest';
import { NativeRecordingVideo } from '../../src/recording/native-video.js';
import type {
  NativeRecordingPacket,
  RecordingApi,
} from '../../src/recording/protocol.js';

/** The renderer must finish consuming a packet before returning its native credit. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const packet: NativeRecordingPacket = {
  sequence: 1,
  timestamp: 0,
  duration: 1 / 30,
  key: true,
  data: new Uint8Array([1]),
  config: new Uint8Array([1, 77, 0, 40]),
};

describe('native recording consumer', () => {
  it('waits for exclusion and first consumed frame; acknowledges only after consumption and drains on stop', async () => {
    const filtering = deferred<unknown>();
    const consuming = deferred<void>();
    const end = deferred<unknown>();
    const onError = vi.fn();
    let reads = 0;
    const request = vi.fn(async (action: string) => {
      if (action === 'native-prepare') return { id: 4, width: 320, height: 240 };
      if (action === 'native-start') return filtering.promise;
      if (action === 'native-next') return ++reads === 1 ? packet : end.promise;
      if (action === 'native-stop') end.resolve(null);
    });
    const video = new NativeRecordingVideo({ request, onCommand() {} }, onError);
    await video.prepare();
    const output = vi.fn(async () => {});
    const consume = vi.fn(() => consuming.promise);
    let started = false;
    const start = video.start(consume, output).then(() => {
      started = true;
    });
    expect(output).not.toHaveBeenCalled();
    filtering.resolve(true);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledWith(packet));
    expect(started).toBe(false);
    expect(reads).toBe(1);
    consuming.resolve();
    await start;
    expect(request).toHaveBeenCalledWith('native-next', { id: 4, sequence: 1 });
    await video.stop();
    expect(onError).not.toHaveBeenCalled();
    video.dispose();
  });

  it('releases a preparation that completes after cancellation', async () => {
    const pending = deferred<unknown>();
    const request = vi.fn((action: string) =>
      action === 'native-prepare' ? pending.promise : Promise.resolve(true)
    );
    const video = new NativeRecordingVideo(
      { request } as unknown as RecordingApi,
      vi.fn()
    );
    const preparing = video.prepare();
    const rejected = expect(preparing).rejects.toThrow('cancelled');
    video.dispose();
    pending.resolve({ id: 7, width: 320, height: 240 });
    await rejected;
    expect(request).toHaveBeenCalledWith('native-release', { id: 7 });
  });

  it('propagates filter failure before starting output or consuming screen frames', async () => {
    const request = vi.fn(async (action: string) => {
      if (action === 'native-prepare') return { id: 1, width: 320, height: 240 };
      throw new Error('Unresolved excluded window');
    });
    const video = new NativeRecordingVideo({ request, onCommand() {} }, vi.fn());
    await video.prepare();
    const consume = vi.fn();
    const output = vi.fn();
    await expect(video.start(consume, output)).rejects.toThrow('excluded window');
    expect(output).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    video.dispose();
  });
});
