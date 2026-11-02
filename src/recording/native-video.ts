import type { NativeRecordingPacket, RecordingApi } from './protocol.js';

/** Pull one compressed packet at a time; acknowledge only after muxing/decoding completes. */
export class NativeRecordingVideo {
  #id = 0;
  #closed = false;
  #pump: Promise<void> | undefined;
  #fault: unknown;
  constructor(
    private readonly api: RecordingApi,
    private readonly onError: (error: unknown) => void
  ) {}
  async prepare() {
    const value = (await this.api.request('native-prepare')) as {
      id: number;
      width: number;
      height: number;
    };
    this.#id = value.id;
    if (this.#closed) {
      this.dispose();
      throw new Error('Native video preparation cancelled.');
    }
    return { width: value.width, height: value.height };
  }
  async start(
    consume: (packet: NativeRecordingPacket) => Promise<void>,
    beginOutput: () => Promise<void>
  ) {
    await this.api.request('native-start', { id: this.#id });
    await beginOutput();
    let firstResolve!: () => void;
    let firstReject!: (error: unknown) => void;
    const first = new Promise<void>((resolve, reject) => {
      firstResolve = resolve;
      firstReject = reject;
    });
    this.#pump = (async () => {
      let sequence: number | undefined;
      while (!this.#closed) {
        const packet = (await this.api.request('native-next', {
          id: this.#id,
          sequence,
        })) as NativeRecordingPacket | null;
        if (!packet || this.#closed) {
          firstReject(new Error('Native video ended before its first frame.'));
          return;
        }
        await consume(packet);
        firstResolve();
        sequence = packet.sequence;
      }
    })().catch((error) => {
      firstReject(error);
      if (!this.#closed) {
        this.#fault = error;
        this.onError(error);
      }
    });
    await first;
  }
  pause(paused: boolean, elapsed: number) {
    void this.api
      .request('native-pause', { id: this.#id, paused, elapsed })
      .catch((error) => {
        if (!this.#closed) this.onError(error);
      });
  }
  async stop() {
    await this.api.request('native-stop', { id: this.#id });
    await this.#pump;
    if (this.#fault) throw this.#fault;
  }
  dispose() {
    this.#closed = true;
    if (this.#id) {
      void this.api.request('native-release', { id: this.#id }).catch(() => {});
      this.#id = 0;
    }
  }
}
