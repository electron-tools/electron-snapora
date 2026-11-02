import {
  Output,
  Mp4OutputFormat,
  StreamTarget,
  MediaStreamVideoTrackSource,
  MediaStreamAudioTrackSource,
  canEncodeVideo,
  canEncodeAudio,
  Quality,
  type StreamTargetChunk,
  EncodedVideoPacketSource,
  EncodedPacket,
} from 'mediabunny';
import type { RecordingInit, RecordingApi, NativeRecordingPacket } from './protocol.js';
import { NativeRecordingVideo } from './native-video.js';
import type { RecordingOptions } from '../types.js';
import { recordingSize, RecordingClock } from './policy.js';

/** Encoding is owned by a dedicated renderer. File writes acknowledge before the pipeline advances. */
export class RecordingEngine {
  #native: NativeRecordingVideo | undefined;
  #encodedSource: EncodedVideoPacketSource | undefined;
  #decoder: VideoDecoder | undefined;
  #nativeCanvas: HTMLCanvasElement | undefined;
  #nativeConfigured = false;
  #decodeDone: (() => void) | undefined;
  #decodeReject: ((error: unknown) => void) | undefined;
  #streams: MediaStream[] = [];
  #context: AudioContext | undefined;
  #output: Output | undefined;
  #videoSource: MediaStreamVideoTrackSource | undefined;
  #audioSource: MediaStreamAudioTrackSource | undefined;
  #worker: Worker | undefined;
  #video: HTMLVideoElement | undefined;
  #canvas: HTMLCanvasElement | undefined;
  #clock: RecordingClock | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: Promise<void> = Promise.resolve();
  #previous: ImageData | undefined;
  #previousTime = 0;
  #gifCentiseconds = 0;
  #offset = 0;
  #stopped = false;
  #paused = false;
  #mixedAudio: MediaStreamTrack | undefined;
  #size = { width: 0, height: 0 };
  #crop = { x: 0, y: 0, width: 0, height: 0 };
  lastVideoAt = 0;
  lastAudioAt = 0;
  hasAudio = false;

  constructor(
    private readonly init: RecordingInit,
    private readonly settings: RecordingOptions,
    private readonly write: (data: Uint8Array, offset: number) => Promise<void>,
    private readonly onError: (error: unknown) => void
  ) {}

  async prepare(): Promise<void> {
    const audio =
      this.settings.format === 'gif' ? 'none' : (this.settings.audio ?? 'none');
    const capture =
      !this.init.nativeVideo || audio === 'system' || audio === 'both'
        ? await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30 },
            audio: audio === 'system' || audio === 'both',
          })
        : undefined;
    if (capture) this.#keep(capture);
    if ((audio === 'system' || audio === 'both') && !capture?.getAudioTracks().length)
      throw new Error(
        'System audio is unavailable. Check macOS audio permission or choose no system audio.'
      );
    if (audio === 'microphone' || audio === 'both')
      this.#keep(
        await navigator.mediaDevices.getUserMedia({
          audio: this.settings.microphoneDeviceId
            ? { deviceId: { exact: this.settings.microphoneDeviceId } }
            : true,
          video: false,
        })
      );
    const tracks = this.#streams.flatMap((s) => s.getAudioTracks());
    if (tracks.length) {
      this.hasAudio = true;
      this.#context = new AudioContext({ sampleRate: 48000 });
      const destination = this.#context.createMediaStreamDestination();
      for (const track of tracks)
        this.#context
          .createMediaStreamSource(new MediaStream([track]))
          .connect(destination);
      this.#streams.push(destination.stream);
      this.#mixedAudio = destination.stream.getAudioTracks()[0];
      await this.#context.resume();
    }
    for (const stream of this.#streams)
      for (const track of stream.getTracks())
        track.addEventListener('ended', () => {
          if (!this.#stopped)
            this.onError(new Error('A recording source disconnected.'));
        });
    if (this.init.nativeVideo) {
      this.#native = new NativeRecordingVideo(
        (window as unknown as { snaporaRecording: RecordingApi }).snaporaRecording,
        this.onError
      );
      this.#size = await this.#native.prepare();
      this.#crop = { x: 0, y: 0, ...this.#size };
    } else {
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = capture!;
      await video.play();
      this.#video = video;
      const sx = video.videoWidth / this.init.display.bounds.width;
      const sy = video.videoHeight / this.init.display.bounds.height;
      this.#crop = {
        x: Math.round(this.init.selection.x * sx),
        y: Math.round(this.init.selection.y * sy),
        width: Math.round(this.init.selection.width * sx),
        height: Math.round(this.init.selection.height * sy),
      };
      this.#size = recordingSize(
        this.#crop.width,
        this.#crop.height,
        this.settings.format ?? 'mp4'
      );
    }
    if (this.settings.format === 'gif') {
      this.#canvas = document.createElement('canvas');
      Object.assign(this.#canvas, this.#size);
      this.#worker = new Worker(new URL('./gif-worker.ts', import.meta.url), {
        type: 'module',
      });
      if (this.#native) {
        this.#nativeCanvas = document.createElement('canvas');
        Object.assign(this.#nativeCanvas, this.#size);
        this.#decoder = new VideoDecoder({
          output: (frame) => {
            try {
              this.#nativeCanvas!.getContext('2d')!.drawImage(frame, 0, 0);
              this.lastVideoAt = performance.now();
              this.#decodeDone?.();
            } finally {
              frame.close();
              this.#decodeDone = this.#decodeReject = undefined;
            }
          },
          error: (error) => {
            this.#decodeReject?.(error);
            this.onError(error);
          },
        });
      }
    } else {
      const videoQuality = new Quality({ bitrate: 4_000_000 });
      const audioQuality = new Quality({ bitrate: 128_000 });
      const probe = { ...this.#size, quality: videoQuality, frameRate: 30 };
      const hardwareAcceleration = (await canEncodeVideo('avc', {
        ...probe,
        hardwareAcceleration: 'prefer-hardware',
      }))
        ? 'prefer-hardware'
        : 'no-preference';
      if (
        !this.#native &&
        !(await canEncodeVideo('avc', { ...probe, hardwareAcceleration }))
      )
        throw new Error('H.264 encoding is unavailable for this recording size.');
      if (
        this.hasAudio &&
        !(await canEncodeAudio('aac', {
          numberOfChannels: 2,
          sampleRate: 48000,
          quality: audioQuality,
        }))
      )
        throw new Error('AAC encoding is unavailable in this Electron build.');
      this.#output = new Output({
        format: new Mp4OutputFormat({
          fastStart: 'fragmented',
          minimumFragmentDuration: 1,
        }),
        target: new StreamTarget(
          new WritableStream<StreamTargetChunk>({
            write: async (chunk) => {
              if (chunk.position !== this.#offset)
                throw new Error('MP4 output attempted a non-append write.');
              await this.#write(chunk.data);
            },
          })
        ),
      });
      if (this.#native) {
        this.#encodedSource = new EncodedVideoPacketSource('avc');
        this.#output.addVideoTrack(this.#encodedSource, { frameRate: 30 });
      } else {
        this.#videoSource = new MediaStreamVideoTrackSource(
          capture!.getVideoTracks()[0]!,
          {
            codec: 'avc',
            quality: videoQuality,
            keyFrameInterval: 1,
            latencyMode: 'realtime',
            hardwareAcceleration,
            transform: {
              crop: {
                left: this.#crop.x,
                top: this.#crop.y,
                width: this.#crop.width,
                height: this.#crop.height,
              },
              width: this.#size.width,
              height: this.#size.height,
              fit: 'fill',
            },
            onEncodedPacket: () => {
              this.lastVideoAt = performance.now();
            },
          },
          { frameRate: 30, timestampBase: 'synced-zero' }
        );
        this.#output.addVideoTrack(this.#videoSource, { frameRate: 30 });
        void this.#videoSource.errorPromise.catch((error) => {
          if (!this.#stopped) this.onError(error);
        });
      }
      if (this.#mixedAudio) {
        this.#audioSource = new MediaStreamAudioTrackSource(
          this.#mixedAudio as ConstructorParameters<
            typeof MediaStreamAudioTrackSource
          >[0],
          {
            codec: 'aac',
            quality: audioQuality,
            onEncodedPacket: () => {
              this.lastAudioAt = performance.now();
            },
          }
        );
        this.#output.addAudioTrack(this.#audioSource);
        void this.#audioSource.errorPromise.catch((error) => {
          if (!this.#stopped) this.onError(error);
        });
      }
    }
  }

  async start(): Promise<void> {
    const beginOutput = async () => {
      this.#clock = new RecordingClock(performance.now());
      this.lastAudioAt = this.lastVideoAt = performance.now();
      if (this.#output) await this.#output.start();
    };
    if (this.#native)
      await this.#native.start((packet) => this.#nativePacket(packet), beginOutput);
    else await beginOutput();
    if (!this.#output) this.#tick();
  }

  seconds(): number {
    return this.#clock?.seconds(performance.now()) ?? 0;
  }

  pause(paused: boolean): void {
    this.#paused = paused;
    this.#native?.pause(paused, this.seconds());
    if (paused) {
      this.#clock?.pause(performance.now());
      this.#videoSource?.pause();
      this.#audioSource?.pause();
    } else {
      this.#clock?.resume(performance.now());
      this.#videoSource?.resume();
      this.#audioSource?.resume();
      this.lastAudioAt = this.lastVideoAt = performance.now();
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#videoSource?.close();
    this.#audioSource?.close();
    if (this.#native) await this.#native.stop();
    this.#encodedSource?.close();
    await this.#pending;
    if (this.#output) await this.#output.finalize();
    else if (this.#worker) {
      if (this.#previous)
        await this.#gifFrame(
          this.#previous,
          Math.max(0.01, this.seconds() - this.#previousTime)
        );
      await this.#write(await this.#workerRequest({ finish: true }));
    }
    this.dispose();
  }

  dispose(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#native?.dispose();
    this.#decodeReject?.(new Error('Native video decoder disposed.'));
    if (this.#decoder && this.#decoder.state !== 'closed') this.#decoder.close();
    this.#worker?.terminate();
    for (const stream of this.#streams)
      for (const track of stream.getTracks()) track.stop();
    this.#streams = [];
    void this.#context?.close();
    if (this.#video) this.#video.srcObject = null;
    this.#previous = undefined;
    if (this.#output && ['pending', 'started'].includes(this.#output.state))
      void this.#output.cancel().catch(() => {});
  }

  #keep(stream: MediaStream) {
    if (this.#stopped) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Recording preparation cancelled.');
    }
    this.#streams.push(stream);
  }

  async #nativePacket(packet: NativeRecordingPacket) {
    const codec = `avc1.${Array.from(packet.config.slice(1, 4), (v) => v.toString(16).padStart(2, '0')).join('')}`;
    const config: VideoDecoderConfig = {
      codec,
      codedWidth: this.#size.width,
      codedHeight: this.#size.height,
      description: new Uint8Array(packet.config),
      optimizeForLatency: true,
    };
    if (this.#encodedSource) {
      await this.#encodedSource.add(
        new EncodedPacket(
          packet.data,
          packet.key ? 'key' : 'delta',
          packet.timestamp,
          packet.duration,
          packet.sequence
        ),
        this.#nativeConfigured ? undefined : { decoderConfig: config }
      );
    } else if (this.#decoder) {
      if (!this.#nativeConfigured) this.#decoder.configure(config);
      await new Promise<void>((resolve, reject) => {
        this.#decodeDone = resolve;
        this.#decodeReject = reject;
        this.#decoder!.decode(
          new EncodedVideoChunk({
            type: packet.key ? 'key' : 'delta',
            timestamp: Math.round(packet.timestamp * 1_000_000),
            data: new Uint8Array(packet.data),
          })
        );
      });
    }
    this.#nativeConfigured = true;
    this.lastVideoAt = performance.now();
  }

  async #write(data: Uint8Array): Promise<void> {
    for (let i = 0; i < data.byteLength; i += 1024 * 1024) {
      const part = data.slice(i, i + 1024 * 1024);
      await this.write(part, this.#offset);
      this.#offset += part.byteLength;
    }
  }

  #tick(): void {
    if (this.#stopped) return;
    const startedAt = performance.now();
    this.#pending = (async () => {
      if (!this.#paused) {
        const context = this.#canvas!.getContext('2d', { willReadFrequently: true })!;
        const { x, y, width, height } = this.#crop;
        context.drawImage(
          this.#nativeCanvas ?? this.#video!,
          x,
          y,
          width,
          height,
          0,
          0,
          this.#size.width,
          this.#size.height
        );
        const time = Math.min(60, this.seconds());
        if (this.#previous)
          await this.#gifFrame(this.#previous, time - this.#previousTime);
        this.#previous =
          time < 60
            ? context.getImageData(0, 0, this.#size.width, this.#size.height)
            : undefined;
        this.#previousTime = this.#gifCentiseconds === 0 ? 0 : time;
        this.lastVideoAt = performance.now();
      }
    })();
    void this.#pending.then(() => {
      if (!this.#stopped)
        this.#timer = setTimeout(
          () => this.#tick(),
          Math.max(0, 100 - (performance.now() - startedAt))
        );
    }, this.onError);
  }

  async #gifFrame(frame: ImageData, duration: number): Promise<void> {
    // Quantize cumulative time; per-frame rounding must not push a 60s GIF over its ceiling.
    const end = Math.min(6000, Math.round((this.#previousTime + duration) * 100));
    const delay = end - this.#gifCentiseconds;
    if (delay < 1) return;
    const bytes = await this.#workerRequest(
      {
        rgba: frame.data,
        ...this.#size,
        delay: delay * 10,
      },
      [frame.data.buffer]
    );
    await this.#write(bytes);
    this.#gifCentiseconds = end;
  }

  #workerRequest(data: unknown, transfer: Transferable[] = []): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.#worker!.onmessage = (
        event: MessageEvent<{ bytes: Uint8Array; error?: string }>
      ) =>
        event.data.error
          ? reject(new Error(event.data.error))
          : resolve(event.data.bytes);
      this.#worker!.onerror = (event) => reject(new Error(event.message));
      this.#worker!.postMessage(data, transfer);
    });
  }
}
