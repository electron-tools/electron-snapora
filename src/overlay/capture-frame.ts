import type { Size } from '../core/geometry/rect.js';
import type { CapturedFrame } from '../electron/protocol/messages.js';

export const DESKTOP_CAPTURE_TIMEOUT_MS = 2_000;

export interface DrawCapturedFrameOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** 将旧图片帧或 Electron 桌面流的第一帧统一画入截图 Canvas。 */
export async function drawCapturedFrame(
  canvas: HTMLCanvasElement,
  frame: CapturedFrame,
  options: DrawCapturedFrameOptions = {}
): Promise<Size> {
  if (frame.kind !== 'desktop-source') {
    const image = await loadImage(frame.dataUrl, options.signal);
    canvas.width = frame.pixelSize.width;
    canvas.height = frame.pixelSize.height;
    const context = requireCanvasContext(canvas);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return frame.pixelSize;
  }

  return drawDesktopSourceFrame(
    canvas,
    frame,
    options.signal,
    options.timeoutMs ?? DESKTOP_CAPTURE_TIMEOUT_MS
  );
}

async function drawDesktopSourceFrame(
  canvas: HTMLCanvasElement,
  frame: Extract<CapturedFrame, { kind: 'desktop-source' }>,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Size> {
  const deadline = Date.now() + timeoutMs;
  const stream = await waitForDeadline(
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        cursor: 'never',
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: frame.sourceId,
          maxWidth: frame.pixelSize.width,
          maxHeight: frame.pixelSize.height,
        },
      },
    } as unknown as MediaStreamConstraints),
    deadline,
    signal,
    stopStream
  );
  const video = document.createElement('video');
  try {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await waitForDeadline(video.play(), deadline, signal);
    await waitForFirstVideoFrame(video, deadline, signal);
    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error('Desktop capture returned an empty video frame.');
    }
    const pixelSize = { width: video.videoWidth, height: video.videoHeight };
    canvas.width = pixelSize.width;
    canvas.height = pixelSize.height;
    requireCanvasContext(canvas).drawImage(
      video,
      0,
      0,
      pixelSize.width,
      pixelSize.height
    );
    return pixelSize;
  } finally {
    stopStream(stream);
    video.srcObject = null;
  }
}

function requireCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Electron Snapora could not create the screen canvas.');
  }
  return context;
}

function loadImage(dataUrl: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      image.src = '';
      reject(createAbortError());
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('The captured screen image could not be loaded.'));
    };
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    image.src = dataUrl;
  });
}

function waitForFirstVideoFrame(
  video: HTMLVideoElement,
  deadline: number,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let frameCallbackId: number | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      video.removeEventListener('error', handleError);
      if (frameCallbackId !== undefined) {
        video.cancelVideoFrameCallback?.(frameCallbackId);
      }
    };
    const finish = (error?: Error) => {
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const handleAbort = () => finish(createAbortError());
    const handleError = () => finish(new Error('Desktop capture video failed.'));
    const timer = setTimeout(
      () => finish(new Error('Timed out while capturing the desktop frame.')),
      remainingTime(deadline)
    );

    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    video.addEventListener('error', handleError, { once: true });
    if (video.requestVideoFrameCallback) {
      frameCallbackId = video.requestVideoFrameCallback(() => finish());
    } else {
      requestAnimationFrame(() => finish());
    }
  });
}

function waitForDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  signal?: AbortSignal,
  disposeLateValue?: (value: T) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => fail(createAbortError());
    const timer = setTimeout(
      () => fail(new Error('Timed out while capturing the desktop frame.')),
      remainingTime(deadline)
    );

    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) {
          disposeLateValue?.(value);
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) =>
        fail(error instanceof Error ? error : new Error('Desktop capture failed.'))
    );
  });
}

function remainingTime(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

function createAbortError(): DOMException {
  return new DOMException('Desktop capture was cancelled.', 'AbortError');
}
