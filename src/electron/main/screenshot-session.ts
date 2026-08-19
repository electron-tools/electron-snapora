import type { IpcMain, IpcMainEvent } from 'electron';

import type { ScreenshotOptions, ScreenshotResult } from '../../types.js';
import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import {
  SCREENSHOT_PROTOCOL_VERSION,
  type CaptureDisplay,
  type CapturedFrame,
  type ScreenCaptureAdapter,
} from '../protocol/messages.js';
import {
  findCapturedFrameLimitViolation,
  resolveScreenshotResourceLimits,
  type ScreenshotResourceLimitOptions,
  type ScreenshotResourceLimits,
} from '../protocol/limits.js';
import {
  isCancelPayload,
  isCompletePayload,
  isErrorPayload,
  isPreparedPayload,
  isReadyPayload,
} from '../protocol/validators.js';
import { ScreenshotError, toScreenshotFailure } from './errors.js';
import type { ScreenshotOverlayWindow } from './overlay-window.js';

export type ScreenshotSessionState =
  | 'idle'
  | 'capturing'
  | 'opening-overlay'
  | 'preparing-overlay'
  | 'editing'
  | 'exporting'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ScreenshotOverlayFactory = (
  display: CaptureDisplay
) => ScreenshotOverlayWindow;

export interface ScreenshotSessionOptions {
  jobId: string;
  captureOptions: ScreenshotOptions;
  captureAdapter: ScreenCaptureAdapter;
  ipcMain: Pick<IpcMain, 'on' | 'removeListener'>;
  createOverlay: ScreenshotOverlayFactory;
  overlayReadyTimeoutMs?: number;
  onSettled?: () => void;
  registerOutputHandler?: (senderWebContentsId: number, jobId: string) => () => void;
  resourceLimits?: ScreenshotResourceLimitOptions;
}

type SessionResolver = (result: ScreenshotResult) => void;

/**
 * 管理一次截图任务从屏幕采集到 Overlay 结算的完整生命周期。
 * 所有 IPC 都同时校验发送窗口、协议版本和 jobId，并且只允许结算一次。
 */
export class ScreenshotSession {
  readonly #options: ScreenshotSessionOptions;
  readonly #resourceLimits: ScreenshotResourceLimits;
  #state: ScreenshotSessionState = 'idle';
  #overlay: ScreenshotOverlayWindow | undefined;
  #frames: CapturedFrame[] = [];
  #resolve: SessionResolver | undefined;
  #settled = false;
  #readyTimer: ReturnType<typeof setTimeout> | undefined;
  #windowCleanups: Array<() => void> = [];

  constructor(options: ScreenshotSessionOptions) {
    this.#options = options;
    this.#resourceLimits = resolveScreenshotResourceLimits(options.resourceLimits);
  }

  get state(): ScreenshotSessionState {
    return this.#state;
  }

  /** 允许主进程在宿主窗口销毁或业务主动终止时结束任意活动阶段。 */
  cancel(): boolean {
    if (this.#settled || this.#state === 'idle') {
      return false;
    }
    this.#settle({ status: 'cancelled' });
    return true;
  }

  run(): Promise<ScreenshotResult> {
    if (this.#state !== 'idle') {
      return Promise.resolve({
        status: 'failed',
        code: 'INVALID_RESULT',
        message: 'A screenshot session can only be run once.',
      });
    }

    return new Promise((resolve) => {
      this.#resolve = resolve;
      void this.#start();
    });
  }

  async #start(): Promise<void> {
    this.#state = 'capturing';

    let frames: CapturedFrame[];
    try {
      frames = await this.#options.captureAdapter.capture(this.#options.captureOptions);
      if (this.#settled) {
        return;
      }
      if (!frames[0]) {
        throw new ScreenshotError(
          'CAPTURE_FAILED',
          'Screen capture returned no frames.'
        );
      }
      for (const frame of frames) {
        const violation = findCapturedFrameLimitViolation(frame, this.#resourceLimits);
        if (violation) {
          throw new ScreenshotError('RESOURCE_LIMIT_EXCEEDED', violation);
        }
      }
    } catch (error) {
      this.#settle(toScreenshotFailure(error));
      return;
    }

    try {
      this.#state = 'opening-overlay';
      this.#frames = frames;
      this.#overlay = this.#options.createOverlay(frames[0].display);
      this.#registerListeners();
      this.#startReadyTimeout();
      await this.#overlay.load();
      if (this.#settled) {
        return;
      }
    } catch (error) {
      this.#settle(toScreenshotFailure(error, 'OVERLAY_LOAD_FAILED'));
      return;
    }

    // ready 消息可能在 load() resolve 前到达；只有尚未 ready 时才继续等待超时。
    if (this.#state !== 'opening-overlay') {
      return;
    }
  }

  #registerListeners(): void {
    this.#options.ipcMain.on(OVERLAY_CHANNELS.ready, this.#handleReady);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.prepared, this.#handlePrepared);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.confirm, this.#handleConfirm);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.cancel, this.#handleCancel);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.error, this.#handleError);

    if (this.#overlay) {
      const outputCleanup = this.#options.registerOutputHandler?.(
        this.#overlay.webContentsId,
        this.#options.jobId
      );
      if (outputCleanup) {
        this.#windowCleanups.push(outputCleanup);
      }
      this.#windowCleanups.push(
        this.#overlay.onClosed(() => {
          if (!this.#settled) {
            this.#settle({ status: 'cancelled' });
          }
        }),
        this.#overlay.onRendererGone(() => {
          if (!this.#settled) {
            this.#settle({
              status: 'failed',
              code: 'OVERLAY_LOAD_FAILED',
              message: 'The screenshot overlay renderer exited unexpectedly.',
            });
          }
        })
      );
    }
  }

  #handleReady = (event: IpcMainEvent, payload: unknown): void => {
    if (!this.#isExpectedSender(event)) {
      return;
    }

    if (!isReadyPayload(payload)) {
      this.#settleInvalidMessage('Invalid overlay ready message.');
      return;
    }

    if (this.#state !== 'opening-overlay' || !this.#overlay) {
      return;
    }

    this.#clearReadyTimeout();
    this.#state = 'preparing-overlay';
    this.#overlay.prime();
    this.#overlay.sendInitialize({
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: this.#options.jobId,
      options: this.#options.captureOptions,
      frames: this.#frames,
    });
    this.#frames = [];
    this.#startReadyTimeout(
      'The screenshot overlay did not prepare its captured frame in time.'
    );
  };

  #handlePrepared = (event: IpcMainEvent, payload: unknown): void => {
    if (!this.#isExpectedSender(event)) {
      return;
    }

    if (!isPreparedPayload(payload, this.#options.jobId)) {
      this.#settleInvalidMessage('Invalid overlay prepared message.');
      return;
    }

    if (this.#state !== 'preparing-overlay' || !this.#overlay) {
      return;
    }

    this.#clearReadyTimeout();
    this.#state = 'editing';
    this.#overlay.reveal();
  };

  #handleConfirm = (event: IpcMainEvent, payload: unknown): void => {
    if (!this.#isExpectedSender(event) || this.#state !== 'editing') {
      return;
    }

    if (
      !isCompletePayload(
        payload,
        this.#options.jobId,
        this.#resourceLimits.maxOutputBytes
      )
    ) {
      this.#settleInvalidMessage('Invalid screenshot completion message.');
      return;
    }

    this.#state = 'exporting';
    this.#settle(payload.result);
  };

  #handleCancel = (event: IpcMainEvent, payload: unknown): void => {
    if (
      !this.#isExpectedSender(event) ||
      (this.#state !== 'preparing-overlay' && this.#state !== 'editing')
    ) {
      return;
    }

    if (!isCancelPayload(payload, this.#options.jobId)) {
      this.#settleInvalidMessage('Invalid screenshot cancellation message.');
      return;
    }

    this.#settle({ status: 'cancelled' });
  };

  #handleError = (event: IpcMainEvent, payload: unknown): void => {
    if (
      !this.#isExpectedSender(event) ||
      (this.#state !== 'preparing-overlay' && this.#state !== 'editing')
    ) {
      return;
    }

    if (!isErrorPayload(payload, this.#options.jobId)) {
      this.#settleInvalidMessage('Invalid screenshot error message.');
      return;
    }

    this.#settle({
      status: 'failed',
      code: payload.code,
      message: payload.message,
    });
  };

  #isExpectedSender(event: IpcMainEvent): boolean {
    return (
      this.#overlay !== undefined && event.sender.id === this.#overlay.webContentsId
    );
  }

  #settleInvalidMessage(message: string): void {
    this.#settle({
      status: 'failed',
      code: 'INVALID_RESULT',
      message,
    });
  }

  #startReadyTimeout(
    message = 'The screenshot overlay did not become ready in time.'
  ): void {
    this.#clearReadyTimeout();
    const timeoutMs = this.#options.overlayReadyTimeoutMs ?? 10_000;
    this.#readyTimer = setTimeout(() => {
      this.#settle({
        status: 'failed',
        code: 'OVERLAY_LOAD_FAILED',
        message,
      });
    }, timeoutMs);
    this.#readyTimer.unref?.();
  }

  #clearReadyTimeout(): void {
    if (this.#readyTimer) {
      clearTimeout(this.#readyTimer);
      this.#readyTimer = undefined;
    }
  }

  #settle(result: ScreenshotResult): void {
    if (this.#settled) {
      return;
    }

    this.#settled = true;
    this.#state =
      result.status === 'completed'
        ? 'completed'
        : result.status === 'cancelled'
          ? 'cancelled'
          : 'failed';

    this.#clearReadyTimeout();
    this.#removeListeners();
    this.#frames = [];
    this.#overlay?.destroy();
    this.#options.onSettled?.();
    this.#resolve?.(result);
    this.#resolve = undefined;
  }

  #removeListeners(): void {
    this.#options.ipcMain.removeListener(OVERLAY_CHANNELS.ready, this.#handleReady);
    this.#options.ipcMain.removeListener(
      OVERLAY_CHANNELS.prepared,
      this.#handlePrepared
    );
    this.#options.ipcMain.removeListener(OVERLAY_CHANNELS.confirm, this.#handleConfirm);
    this.#options.ipcMain.removeListener(OVERLAY_CHANNELS.cancel, this.#handleCancel);
    this.#options.ipcMain.removeListener(OVERLAY_CHANNELS.error, this.#handleError);

    for (const cleanup of this.#windowCleanups.splice(0)) {
      cleanup();
    }
  }
}
