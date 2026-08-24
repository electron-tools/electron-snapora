import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawCapturedFrame } from './capture-frame.js';
import { exportSelectionPng } from './export-selection.js';

describe('selection PNG export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws only the selected image rectangle into an offscreen canvas', async () => {
    const drawImage = vi.fn();
    const convertToBlob = vi.fn(
      async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    );
    const OffscreenCanvasMock = vi.fn(
      class {
        getContext = vi.fn(() => ({ drawImage }));
        convertToBlob = convertToBlob;

        constructor(
          readonly width: number,
          readonly height: number
        ) {}
      }
    );
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);
    const source = {} as CanvasImageSource;

    const result = await exportSelectionPng(source, {
      x: 20,
      y: 30,
      width: 120,
      height: 80,
    });

    expect(OffscreenCanvasMock).toHaveBeenCalledWith(120, 80);
    expect(drawImage).toHaveBeenCalledWith(source, 20, 30, 120, 80, 0, 0, 120, 80);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects an empty selection before creating a canvas', async () => {
    await expect(
      exportSelectionPng({} as CanvasImageSource, {
        x: 0,
        y: 0,
        width: 0,
        height: 10,
      })
    ).rejects.toThrow('must not be empty');
  });

  it('composites annotations after cropping the captured frame', async () => {
    const context = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      strokeRect: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineCap: 'butt',
      lineJoin: 'miter',
      lineWidth: 1,
    };
    const OffscreenCanvasMock = vi.fn(
      class {
        getContext = vi.fn(() => context);
        convertToBlob = vi.fn(
          async () => new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })
        );

        constructor(
          readonly width: number,
          readonly height: number
        ) {}
      }
    );
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);

    await exportSelectionPng(
      {} as CanvasImageSource,
      { x: 20, y: 30, width: 120, height: 80 },
      [
        {
          id: 'rectangle-1',
          type: 'rectangle',
          zIndex: 0,
          createdAt: 1,
          color: '#f00',
          lineWidth: 4,
          bounds: { x: 40, y: 45, width: 30, height: 20 },
        },
      ],
      { width: 400, height: 300 }
    );

    expect(context.translate).toHaveBeenCalledWith(-20, -30);
    expect(context.strokeRect).toHaveBeenCalledWith(40, 45, 30, 20);
  });
});

describe('captured frame canvas', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps legacy custom-adapter Data URLs compatible with the canvas', async () => {
    class ImageMock {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      #src = '';

      get src(): string {
        return this.#src;
      }

      set src(value: string) {
        this.#src = value;
        if (value) {
          queueMicrotask(() => this.onload?.());
        }
      }
    }
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal('Image', ImageMock);

    await drawCapturedFrame(canvas, {
      display: {
        id: '10',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        scaleFactor: 1,
      },
      dataUrl: 'data:image/png;base64,c25hcG9yYQ==',
      pixelSize: { width: 800, height: 600 },
    });

    expect(drawImage).toHaveBeenCalledWith(expect.any(ImageMock), 0, 0, 800, 600);
  });

  it('draws a desktop video frame and always stops its stream', async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
    } as unknown as HTMLCanvasElement;
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    const video = {
      muted: false,
      playsInline: false,
      srcObject: null,
      videoWidth: 800,
      videoHeight: 600,
      play: vi.fn(async () => undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestVideoFrameCallback: vi.fn((callback: VideoFrameRequestCallback) => {
        queueMicrotask(() => callback(0, {} as VideoFrameCallbackMetadata));
        return 1;
      }),
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });

    const pixelSize = await drawCapturedFrame(canvas, {
      kind: 'desktop-source',
      display: {
        id: '10',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        scaleFactor: 1,
      },
      sourceId: 'screen:10:0',
      pixelSize: { width: 801, height: 601 },
    });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        cursor: 'never',
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: 'screen:10:0',
          maxWidth: 801,
          maxHeight: 601,
        },
      },
    });
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 800, 600);
    expect(pixelSize).toEqual({ width: 800, height: 600 });
    expect(canvas).toMatchObject({ width: 800, height: 600 });
    expect(stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });

  it('stops the desktop stream when first-frame playback times out', async () => {
    vi.useFakeTimers();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    } as unknown as HTMLCanvasElement;
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    const video = {
      muted: false,
      playsInline: false,
      srcObject: null,
      videoWidth: 800,
      videoHeight: 600,
      play: vi.fn(() => new Promise<void>(() => undefined)),
    } as unknown as HTMLVideoElement;
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });

    const drawing = drawCapturedFrame(
      canvas,
      {
        kind: 'desktop-source',
        display: {
          id: '10',
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          scaleFactor: 1,
        },
        sourceId: 'screen:10:0',
        pixelSize: { width: 800, height: 600 },
      },
      { timeoutMs: 50 }
    );
    const rejected = expect(drawing).rejects.toThrow(
      'Timed out while capturing the desktop frame.'
    );

    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
  });
});
