import { globalShortcut } from 'electron';
import type { IpcMain, IpcMainEvent } from 'electron';

import type {
  ScreenshotBounds,
  ScreenshotOptions,
  ScreenshotResult,
} from '../../types.js';
import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import {
  SCREENSHOT_PROTOCOL_VERSION,
  type CaptureDisplay,
  type CapturedFrame,
  type OverlayShortcutPayload,
  type ScreenCaptureAdapter,
  type ScreenshotTextEditingPayload,
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
import {
  emitScreenshotDiagnostic,
  type ScreenshotDiagnosticContextValue,
  type ScreenshotDiagnosticListener,
  type ScreenshotDiagnosticPhase,
  type ScreenshotDiagnosticStage,
} from './diagnostics.js';
import { ScreenshotError, toScreenshotFailure } from './errors.js';
import type { ScreenshotOverlayWindow } from './overlay-window.js';
import { PackagedResourceError } from './resource-paths.js';

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

export type ScreenshotGlobalShortcut = Pick<
  typeof globalShortcut,
  'register' | 'unregister' | 'isRegistered'
>;

export interface ScreenshotSessionOptions {
  jobId: string;
  captureOptions: ScreenshotOptions;
  captureAdapter: ScreenCaptureAdapter;
  ipcMain: Pick<IpcMain, 'on' | 'removeListener'>;
  globalShortcut?: ScreenshotGlobalShortcut;
  createOverlay: ScreenshotOverlayFactory;
  overlayReadyTimeoutMs?: number;
  onSettled?: (result: ScreenshotResult) => void;
  registerOutputHandler?: (senderWebContentsId: number, jobId: string) => () => void;
  resourceLimits?: ScreenshotResourceLimitOptions;
  onDiagnostic?: ScreenshotDiagnosticListener;
  windowSnapRegions?: ScreenshotBounds[];
}

type SessionResolver = (result: ScreenshotResult) => void;

interface SessionShortcutDefinition {
  accelerators: string[];
  payload: OverlayShortcutPayload;
  isSingleLetter?: boolean;
}

const SESSION_SHORTCUTS: SessionShortcutDefinition[] = [
  { accelerators: ['Escape'], payload: { key: 'Escape' } },
  { accelerators: ['Return', 'Enter'], payload: { key: 'Enter' } },
  { accelerators: ['Delete'], payload: { key: 'Delete' } },
  { accelerators: ['Backspace'], payload: { key: 'Backspace' } },
  {
    accelerators: ['CommandOrControl+Z'],
    payload: { key: 'z', ctrlKey: true, metaKey: true },
  },
  {
    accelerators: ['CommandOrControl+Shift+Z'],
    payload: { key: 'z', ctrlKey: true, metaKey: true, shiftKey: true },
  },
  {
    accelerators: ['CommandOrControl+Y'],
    payload: { key: 'y', ctrlKey: true, metaKey: true },
  },
  {
    accelerators: ['CommandOrControl+C'],
    payload: { key: 'c', ctrlKey: true, metaKey: true },
  },
  {
    accelerators: ['CommandOrControl+S'],
    payload: { key: 's', ctrlKey: true, metaKey: true },
  },
  { accelerators: ['v', 'V'], payload: { key: 'v' }, isSingleLetter: true },
  { accelerators: ['r', 'R'], payload: { key: 'r' }, isSingleLetter: true },
  { accelerators: ['o', 'O'], payload: { key: 'o' }, isSingleLetter: true },
  { accelerators: ['a', 'A'], payload: { key: 'a' }, isSingleLetter: true },
  { accelerators: ['p', 'P'], payload: { key: 'p' }, isSingleLetter: true },
  { accelerators: ['t', 'T'], payload: { key: 't' }, isSingleLetter: true },
  { accelerators: ['m', 'M'], payload: { key: 'm' }, isSingleLetter: true },
  { accelerators: ['w', 'W'], payload: { key: 'w' }, isSingleLetter: true },
];

/**
 * 管理一次截图任务从屏幕采集到 Overlay 结算的完整生命周期。
 * 所有 IPC 都同时校验发送窗口、协议版本和 jobId，并且只允许结算一次。
 */
export class ScreenshotSession {
  readonly #options: ScreenshotSessionOptions;
  readonly #resourceLimits: ScreenshotResourceLimits;
  readonly #globalShortcut: ScreenshotGlobalShortcut;
  readonly #registeredShortcuts = new Set<string>();
  #textEditingActive = false;
  #state: ScreenshotSessionState = 'idle';
  #overlay: ScreenshotOverlayWindow | undefined;
  #frames: CapturedFrame[] = [];
  #captureDisplay: CaptureDisplay | undefined;
  #fallbackAttempted = false;
  #preparingDesktopSource = false;
  #overlayLoaded = false;
  #rendererReady = false;
  #resolve: SessionResolver | undefined;
  #settled = false;
  #readyTimer: ReturnType<typeof setTimeout> | undefined;
  #windowCleanups: Array<() => void> = [];
  readonly #diagnosticStageStarts = new Map<ScreenshotDiagnosticStage, number>();

  constructor(options: ScreenshotSessionOptions) {
    this.#options = options;
    this.#resourceLimits = resolveScreenshotResourceLimits(options.resourceLimits);
    this.#globalShortcut = options.globalShortcut ?? globalShortcut;
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
    this.#startDiagnosticStage('capture');
    let targetDisplay: CaptureDisplay | undefined;

    // Electron 默认适配器可以同步确定目标屏幕，因此隐藏 Overlay 的加载无需等待截图完成。
    // 窗口直到捕获帧解码、合成完成后才会 prime/reveal，不会进入屏幕截图。
    try {
      targetDisplay = this.#options.captureAdapter.resolveTargetDisplay?.(
        this.#options.captureOptions
      );
      if (targetDisplay) {
        this.#openOverlay(targetDisplay);
      }
    } catch {
      // capture() 会给出规范化的权限或显示器错误；预解析只用于性能优化。
    }

    let frames: CapturedFrame[];
    try {
      frames = targetDisplay
        ? await this.#options.captureAdapter.capture(
            this.#options.captureOptions,
            targetDisplay
          )
        : await this.#options.captureAdapter.capture(this.#options.captureOptions);
      if (this.#settled) {
        return;
      }
      this.#validateCapturedFrames(frames, targetDisplay);
      this.#finishDiagnosticStage('capture', 'complete', {
        captureMode: frames[0]?.kind === 'desktop-source' ? 'desktop-source' : 'image',
        frameCount: frames.length,
        capturePixels: frames.reduce(
          (total, frame) => total + frame.pixelSize.width * frame.pixelSize.height,
          0
        ),
      });
    } catch (error) {
      const failure = toScreenshotFailure(error);
      this.#finishDiagnosticStage('capture', 'error', diagnosticError(error), failure);
      this.#settle(failure);
      return;
    }

    this.#frames = frames;
    const firstFrame = frames[0]!;
    this.#captureDisplay = firstFrame.display;
    this.#state = 'opening-overlay';
    if (!this.#overlay) {
      this.#openOverlay(firstFrame.display);
    }
    this.#prepareOverlayWhenReady();
  }

  #validateCapturedFrames(
    frames: CapturedFrame[],
    expectedDisplay?: CaptureDisplay
  ): void {
    if (!frames[0]) {
      throw new ScreenshotError('CAPTURE_FAILED', 'Screen capture returned no frames.');
    }
    if (expectedDisplay && !isSameDisplayGeometry(expectedDisplay, frames[0].display)) {
      throw new ScreenshotError(
        'DISPLAY_NOT_FOUND',
        'The target display changed while the screenshot was starting. Please retry.'
      );
    }
    for (const frame of frames) {
      const violation = findCapturedFrameLimitViolation(frame, this.#resourceLimits);
      if (violation) {
        throw new ScreenshotError('RESOURCE_LIMIT_EXCEEDED', violation);
      }
    }
  }

  #openOverlay(display: CaptureDisplay): void {
    if (this.#settled || this.#overlay) {
      return;
    }

    this.#startDiagnosticStage('overlay-create');
    try {
      this.#overlay = this.#options.createOverlay(display);
      this.#finishDiagnosticStage('overlay-create', 'complete', {
        displayId: display.id,
        overlayWebContentsId: this.#overlay.webContentsId,
      });
    } catch (error) {
      const failure = toScreenshotFailure(error, 'OVERLAY_LOAD_FAILED');
      this.#finishDiagnosticStage(
        'overlay-create',
        'error',
        diagnosticError(error),
        failure
      );
      this.#settle(failure);
      return;
    }

    this.#registerListeners();
    this.#startReadyTimeout();
    this.#startDiagnosticStage('overlay-load');
    this.#startDiagnosticStage('overlay-ready');
    if (this.#overlay.rendererReady) {
      this.#rendererReady = true;
      this.#finishDiagnosticStage('overlay-ready', 'complete', { reused: true });
    }
    void this.#loadOverlay();
  }

  async #loadOverlay(): Promise<void> {
    try {
      await this.#overlay?.load();
      if (this.#settled) {
        return;
      }
      this.#overlayLoaded = true;
      this.#finishDiagnosticStage('overlay-load', 'complete');
      this.#prepareOverlayWhenReady();
    } catch (error) {
      const failure = toScreenshotFailure(error, 'OVERLAY_LOAD_FAILED');
      this.#finishDiagnosticStage(
        'overlay-load',
        'error',
        diagnosticError(error),
        failure
      );
      this.#settle(failure);
    }
  }

  #registerListeners(): void {
    this.#options.ipcMain.on(OVERLAY_CHANNELS.ready, this.#handleReady);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.prepared, this.#handlePrepared);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.confirm, this.#handleConfirm);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.cancel, this.#handleCancel);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.error, this.#handleError);
    this.#options.ipcMain.on(OVERLAY_CHANNELS.textEditing, this.#handleTextEditing);

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

    if (
      (this.#state !== 'capturing' && this.#state !== 'opening-overlay') ||
      !this.#overlay ||
      this.#rendererReady
    ) {
      return;
    }

    this.#clearReadyTimeout();
    this.#finishDiagnosticStage('overlay-ready', 'complete');
    this.#rendererReady = true;
    this.#prepareOverlayWhenReady();
  };

  #prepareOverlayWhenReady(): void {
    if (
      this.#settled ||
      this.#state !== 'opening-overlay' ||
      !this.#overlay ||
      !this.#overlayLoaded ||
      !this.#rendererReady ||
      !this.#frames[0]
    ) {
      return;
    }

    this.#state = 'preparing-overlay';
    this.#startDiagnosticStage('overlay-prepare');
    this.#overlay.prime();
    this.#preparingDesktopSource = this.#frames[0].kind === 'desktop-source';
    this.#overlay.sendInitialize({
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: this.#options.jobId,
      options: this.#options.captureOptions,
      frames: this.#frames,
      ...(this.#options.windowSnapRegions?.length
        ? { windowSnapRegions: this.#options.windowSnapRegions }
        : {}),
    });
    this.#frames = [];
    this.#startReadyTimeout(
      'The screenshot overlay did not prepare its captured frame in time.'
    );
  }

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
    this.#finishDiagnosticStage('overlay-prepare', 'complete');
    this.#preparingDesktopSource = false;
    this.#state = 'editing';
    this.#overlay.reveal();
    this.#registerSessionShortcuts();
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

    if (payload.fallback === 'capture-image') {
      void this.#captureImageFallback(payload.message);
      return;
    }

    this.#settle({
      status: 'failed',
      code: payload.code,
      message: payload.message,
    });
  };

  async #captureImageFallback(message: string): Promise<void> {
    const adapter = this.#options.captureAdapter;
    const display = this.#captureDisplay;
    if (
      !this.#preparingDesktopSource ||
      this.#fallbackAttempted ||
      !adapter.captureFallback ||
      !display
    ) {
      this.#settle({ status: 'failed', code: 'CAPTURE_FAILED', message });
      return;
    }

    this.#fallbackAttempted = true;
    this.#preparingDesktopSource = false;
    this.#clearReadyTimeout();
    this.#finishDiagnosticStage('overlay-prepare', 'error', {
      fallback: true,
      reason: message,
    });
    this.#state = 'capturing';
    this.#startDiagnosticStage('capture', { fallback: true });
    try {
      const frames = await adapter.captureFallback(
        this.#options.captureOptions,
        display
      );
      if (this.#settled) {
        return;
      }
      this.#validateCapturedFrames(frames, display);
      if (frames.some((frame) => frame.kind === 'desktop-source')) {
        throw new ScreenshotError(
          'CAPTURE_FAILED',
          'The capture fallback did not return an image frame.'
        );
      }
      this.#finishDiagnosticStage('capture', 'complete', {
        captureMode: 'image',
        fallback: true,
        frameCount: frames.length,
      });
      this.#frames = frames;
      this.#state = 'opening-overlay';
      this.#prepareOverlayWhenReady();
    } catch (error) {
      const failure = toScreenshotFailure(error);
      this.#finishDiagnosticStage('capture', 'error', diagnosticError(error), failure);
      this.#settle(failure);
    }
  }

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
    const destroyPreparingDesktopSource =
      result.status === 'cancelled' && this.#preparingDesktopSource;
    const phase: ScreenshotDiagnosticPhase =
      result.status === 'cancelled'
        ? 'cancel'
        : result.status === 'failed'
          ? 'error'
          : 'complete';
    for (const stage of [...this.#diagnosticStageStarts.keys()]) {
      this.#finishDiagnosticStage(stage, phase, undefined, result);
    }
    this.#state =
      result.status === 'completed'
        ? 'completed'
        : result.status === 'cancelled'
          ? 'cancelled'
          : 'failed';

    this.#clearReadyTimeout();
    this.#unregisterSessionShortcuts();
    this.#removeListeners();
    this.#frames = [];
    this.#preparingDesktopSource = false;
    if (
      result.status === 'completed' &&
      result.output.action === 'copy' &&
      this.#options.captureOptions.showCopyFeedback === true &&
      this.#overlay?.showCopyFeedback
    ) {
      this.#overlay.showCopyFeedback(3_000, this.#options.captureOptions);
    } else if (
      !destroyPreparingDesktopSource &&
      result.status !== 'failed' &&
      this.#overlay?.hide
    ) {
      this.#overlay.hide();
    } else {
      this.#overlay?.destroy();
    }
    this.#options.onSettled?.(result);
    this.#resolve?.(result);
    this.#resolve = undefined;
  }

  #handleTextEditing = (event: IpcMainEvent, payload: unknown): void => {
    if (!this.#isExpectedSender(event)) {
      return;
    }
    const active = Boolean(
      payload &&
      typeof payload === 'object' &&
      'active' in payload &&
      (payload as ScreenshotTextEditingPayload).active
    );
    this.#textEditingActive = active;
    if (active) {
      this.#unregisterSingleLetterShortcuts();
    } else {
      this.#registerSingleLetterShortcuts();
    }
  };

  #registerSessionShortcuts(): void {
    for (const item of SESSION_SHORTCUTS) {
      if (item.isSingleLetter && this.#textEditingActive) {
        continue;
      }
      for (const accelerator of item.accelerators) {
        if (this.#registeredShortcuts.has(accelerator)) {
          continue;
        }
        try {
          const registered = this.#globalShortcut.register(accelerator, () => {
            if (this.#settled) {
              return;
            }
            if (item.payload.key === 'Escape') {
              if (this.#overlay) {
                this.#overlay.sendShortcut?.(item.payload);
              } else {
                this.cancel();
              }
              return;
            }
            this.#overlay?.sendShortcut?.(item.payload);
          });
          if (registered) {
            this.#registeredShortcuts.add(accelerator);
          }
        } catch {
          // 忽略注册异常，避免中断截图流程
        }
      }
    }
  }

  #unregisterSingleLetterShortcuts(): void {
    for (const item of SESSION_SHORTCUTS) {
      if (!item.isSingleLetter) {
        continue;
      }
      for (const accelerator of item.accelerators) {
        if (this.#registeredShortcuts.has(accelerator)) {
          try {
            this.#globalShortcut.unregister(accelerator);
          } catch {
            // 忽略注销异常
          }
          this.#registeredShortcuts.delete(accelerator);
        }
      }
    }
  }

  #registerSingleLetterShortcuts(): void {
    if (this.#state !== 'editing' || this.#settled) {
      return;
    }
    for (const item of SESSION_SHORTCUTS) {
      if (!item.isSingleLetter) {
        continue;
      }
      for (const accelerator of item.accelerators) {
        if (this.#registeredShortcuts.has(accelerator)) {
          continue;
        }
        try {
          const registered = this.#globalShortcut.register(accelerator, () => {
            if (this.#settled) {
              return;
            }
            this.#overlay?.sendShortcut?.(item.payload);
          });
          if (registered) {
            this.#registeredShortcuts.add(accelerator);
          }
        } catch {
          // 忽略注册异常
        }
      }
    }
  }

  #unregisterSessionShortcuts(): void {
    for (const accelerator of this.#registeredShortcuts) {
      try {
        this.#globalShortcut.unregister(accelerator);
      } catch {
        // 忽略注销异常
      }
    }
    this.#registeredShortcuts.clear();
  }

  #startDiagnosticStage(
    stage: ScreenshotDiagnosticStage,
    context?: Readonly<Record<string, ScreenshotDiagnosticContextValue>>
  ): void {
    const timestamp = Date.now();
    this.#diagnosticStageStarts.set(stage, timestamp);
    emitScreenshotDiagnostic(this.#options.onDiagnostic, {
      jobId: this.#options.jobId,
      stage,
      phase: 'start',
      timestamp,
      ...(context ? { context } : {}),
    });
  }

  #finishDiagnosticStage(
    stage: ScreenshotDiagnosticStage,
    phase: Exclude<ScreenshotDiagnosticPhase, 'start'>,
    context?: Readonly<Record<string, ScreenshotDiagnosticContextValue>>,
    result?: ScreenshotResult
  ): void {
    const startedAt = this.#diagnosticStageStarts.get(stage);
    if (startedAt === undefined) {
      return;
    }
    this.#diagnosticStageStarts.delete(stage);
    const timestamp = Date.now();
    emitScreenshotDiagnostic(this.#options.onDiagnostic, {
      jobId: this.#options.jobId,
      stage,
      phase,
      timestamp,
      durationMs: Math.max(0, timestamp - startedAt),
      ...(result?.status === 'failed'
        ? { code: result.code, message: result.message }
        : {}),
      ...(context ? { context } : {}),
    });
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
    this.#options.ipcMain.removeListener(
      OVERLAY_CHANNELS.textEditing,
      this.#handleTextEditing
    );

    for (const cleanup of this.#windowCleanups.splice(0)) {
      cleanup();
    }
  }
}

function diagnosticError(
  error: unknown
): Readonly<Record<string, ScreenshotDiagnosticContextValue>> {
  const context: Record<string, ScreenshotDiagnosticContextValue> = {
    errorName: error instanceof Error ? error.name : typeof error,
  };
  if (error instanceof PackagedResourceError) {
    context.missingResources = error.missingResources.map(
      (resource) => `${resource.label}: ${resource.path}`
    );
  }
  return context;
}

/** 预加载窗口的屏幕几何必须与采集帧一致，否则显示会发生缩放或位置错位。 */
function isSameDisplayGeometry(
  expected: CaptureDisplay,
  actual: CaptureDisplay
): boolean {
  return (
    expected.id === actual.id &&
    expected.scaleFactor === actual.scaleFactor &&
    expected.bounds.x === actual.bounds.x &&
    expected.bounds.y === actual.bounds.y &&
    expected.bounds.width === actual.bounds.width &&
    expected.bounds.height === actual.bounds.height
  );
}
