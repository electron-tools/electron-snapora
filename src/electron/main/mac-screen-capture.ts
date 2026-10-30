import type { CaptureDisplay } from '../protocol/messages.js';
import { MacNativeWorker, type MacNativeClient } from './mac-native-worker.js';
import { ScreenshotError } from './errors.js';

/** Pixel capture explicitly excludes only this session's CGWindowIDs, not the host process. */
export interface MacScreenCapture {
  prepare(): Promise<void>;
  capture(
    display: CaptureDisplay,
    excludedWindowIds: string[],
    maxDataUrlBytes: number,
    maxPixels: number,
    signal?: AbortSignal
  ): Promise<string>;
  dispose(): void;
}

/** ScreenCaptureKit screenshot backend. The native process owns PNG encoding and cursor exclusion. */
export class NativeMacScreenCapture implements MacScreenCapture {
  readonly #worker: MacNativeClient;
  constructor(
    executablePath?: string,
    worker: MacNativeClient = new MacNativeWorker(executablePath)
  ) {
    this.#worker = worker;
  }
  prepare(): Promise<void> {
    return this.#worker.prepare();
  }
  async capture(
    display: CaptureDisplay,
    excludedWindowIds: string[],
    maxDataUrlBytes: number,
    maxPixels: number,
    signal?: AbortSignal
  ): Promise<string> {
    if (
      !excludedWindowIds.length ||
      excludedWindowIds.some((id) => !/^[1-9]\d*$/.test(id) || Number(id) > 0xffffffff)
    )
      throw new ScreenshotError(
        'CAPTURE_FAILED',
        'macOS live capture requires valid overlay CGWindowIDs.'
      );
    const response = await this.#worker.request(
      {
        command: 'capture',
        displayId: display.id,
        excludedWindowIds,
        maxBytes: maxDataUrlBytes,
        maxPixels,
      },
      { ...(signal ? { signal } : {}), maxBytes: maxDataUrlBytes + 4096 }
    );
    if (
      typeof response.dataUrl !== 'string' ||
      !response.dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo') ||
      response.dataUrl.length > maxDataUrlBytes
    )
      throw new ScreenshotError('CAPTURE_FAILED', 'Invalid macOS capture response.');
    return response.dataUrl;
  }
  dispose(): void {
    this.#worker.dispose();
  }
}
