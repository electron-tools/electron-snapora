import { randomUUID } from 'node:crypto';

import { ipcMain as electronIpcMain, webContents } from 'electron';
import type { IpcMain } from 'electron';

import type { ScreenshotOptions, ScreenshotResult } from '../../types.js';
import {
  emitScreenshotDiagnostic,
  type ScreenshotDiagnosticContextValue,
  type ScreenshotDiagnosticEvent,
  type ScreenshotDiagnosticListener,
  type ScreenshotDiagnosticPhase,
  type ScreenshotDiagnosticStage,
} from './diagnostics.js';
import { ElectronCaptureAdapter } from './electron-capture-adapter.js';
import {
  ElectronOutputAdapter,
  type ScreenshotOutputExecutor,
} from './electron-output-adapter.js';
import { toScreenshotFailure } from './errors.js';
import { OverlayWindow, type OverlayWindowOptions } from './overlay-window.js';
import { getScreenshotOutputRouter } from './output-action-router.js';
import {
  ScreenshotSession,
  type ScreenshotOverlayFactory,
} from './screenshot-session.js';
import type { ScreenCaptureAdapter } from '../protocol/messages.js';
import {
  resolveScreenshotResourceLimits,
  type ScreenshotResourceLimitOptions,
} from '../protocol/limits.js';

export interface ScreenshotJobContext {
  senderWebContentsId?: number;
}

export interface ScreenshotExecution {
  result: Promise<ScreenshotResult>;
  cancel(): boolean;
}

export type ScreenshotBusyPolicy = 'reject' | 'queue';

export type ScreenshotRunner = (
  jobId: string,
  options: ScreenshotOptions,
  context: ScreenshotJobContext
) => Promise<ScreenshotResult> | ScreenshotExecution;

export type ScreenshotManagerIpcMain = Pick<
  IpcMain,
  'handle' | 'on' | 'removeListener'
>;

export interface ScreenshotManagerOptions {
  /** 完全接管会话执行；设置后其余高层注入项不会参与默认 runner。 */
  runner?: ScreenshotRunner;
  ipcMain?: ScreenshotManagerIpcMain;
  captureAdapter?: ScreenCaptureAdapter;
  outputAdapter?: ScreenshotOutputExecutor;
  createOverlay?: ScreenshotOverlayFactory;
  overlayOptions?: Omit<OverlayWindowOptions, 'display'>;
  overlayReadyTimeoutMs?: number;
  resourceLimits?: ScreenshotResourceLimitOptions;
  /** reject 保持即时失败；queue 仅为其他宿主窗口按 FIFO 排队。 */
  busyPolicy?: ScreenshotBusyPolicy;
  maxQueuedCaptures?: number;
  onDiagnostic?: ScreenshotDiagnosticListener;
}

interface QueuedCapture {
  jobId: string;
  queuedAt: number;
  options: ScreenshotOptions;
  context: ScreenshotJobContext;
  resolve(result: ScreenshotResult): void;
}

const DEFAULT_MAX_QUEUED_CAPTURES = 8;

function createDefaultRunner(
  managerOptions: ScreenshotManagerOptions
): ScreenshotRunner {
  const ipcMain = managerOptions.ipcMain ?? electronIpcMain;
  const resourceLimits = resolveScreenshotResourceLimits(managerOptions.resourceLimits);
  const captureAdapter =
    managerOptions.captureAdapter ?? new ElectronCaptureAdapter({ resourceLimits });
  const outputAdapter = managerOptions.outputAdapter ?? new ElectronOutputAdapter();
  const outputRouter = getScreenshotOutputRouter(ipcMain);
  const createOverlay =
    managerOptions.createOverlay ??
    ((display) => new OverlayWindow({ ...managerOptions.overlayOptions, display }));

  return (jobId, captureOptions, context) => {
    const reportDiagnostic: ScreenshotDiagnosticListener = (event) => {
      emitScreenshotDiagnostic(managerOptions.onDiagnostic, {
        ...event,
        ...(context.senderWebContentsId === undefined
          ? {}
          : { senderWebContentsId: context.senderWebContentsId }),
      });
    };
    const session = new ScreenshotSession({
      jobId,
      captureOptions,
      captureAdapter,
      ipcMain,
      createOverlay,
      ...(managerOptions.overlayReadyTimeoutMs === undefined
        ? {}
        : { overlayReadyTimeoutMs: managerOptions.overlayReadyTimeoutMs }),
      resourceLimits,
      onDiagnostic: reportDiagnostic,
      registerOutputHandler: (senderWebContentsId, activeJobId) =>
        outputRouter.register(
          senderWebContentsId,
          activeJobId,
          async (payload, outputContext) => {
            const startedAt = Date.now();
            reportDiagnostic({
              jobId: activeJobId,
              stage: 'output',
              phase: 'start',
              timestamp: startedAt,
              context: {
                action: payload.action,
                outputBytes: payload.result.data.byteLength,
              },
            });

            let response;
            try {
              response =
                payload.result.data.byteLength > resourceLimits.maxOutputBytes
                  ? {
                      status: 'failed' as const,
                      code: 'RESOURCE_LIMIT_EXCEEDED' as const,
                      message: `Screenshot output exceeds the ${resourceLimits.maxOutputBytes} byte limit.`,
                    }
                  : await outputAdapter.execute(payload, outputContext);
            } catch (error) {
              const timestamp = Date.now();
              reportDiagnostic({
                jobId: activeJobId,
                stage: 'output',
                phase: 'error',
                timestamp,
                durationMs: Math.max(0, timestamp - startedAt),
                code: 'EXPORT_FAILED',
                message:
                  error instanceof Error ? error.message : 'Screenshot output failed.',
                context: { action: payload.action },
              });
              throw error;
            }

            const timestamp = Date.now();
            reportDiagnostic({
              jobId: activeJobId,
              stage: 'output',
              phase:
                response.status === 'failed'
                  ? 'error'
                  : response.status === 'cancelled'
                    ? 'cancel'
                    : 'complete',
              timestamp,
              durationMs: Math.max(0, timestamp - startedAt),
              ...(response.status === 'failed'
                ? { code: response.code, message: response.message }
                : {}),
              context: { action: payload.action },
            });
            return response;
          }
        ),
      onSettled: () => {
        if (context.senderWebContentsId === undefined) {
          return;
        }

        const sender = webContents.fromId(context.senderWebContentsId);
        if (sender && !sender.isDestroyed()) {
          sender.focus();
        }
      },
    });

    return {
      result: session.run(),
      cancel: () => session.cancel(),
    };
  };
}

/**
 * 统一管理截图会话，确保同一时刻只存在一个覆盖层任务。
 * 窗口创建、屏幕采集与导出由 runner 注入，避免核心调度逻辑绑定 Electron 版本细节。
 */
export class ScreenshotManager {
  readonly #runner: ScreenshotRunner;
  readonly #busyPolicy: ScreenshotBusyPolicy;
  readonly #maxQueuedCaptures: number;
  readonly #queue: QueuedCapture[] = [];
  readonly #onDiagnostic: ScreenshotDiagnosticListener | undefined;
  #activeJobId: string | undefined;
  #activeSenderWebContentsId: number | undefined;
  #cancelActive: (() => boolean) | undefined;

  constructor(options: ScreenshotManagerOptions = {}) {
    if (
      options.busyPolicy !== undefined &&
      !['reject', 'queue'].includes(options.busyPolicy)
    ) {
      throw new TypeError('busyPolicy must be either reject or queue.');
    }
    this.#busyPolicy = options.busyPolicy ?? 'reject';
    this.#maxQueuedCaptures = options.maxQueuedCaptures ?? DEFAULT_MAX_QUEUED_CAPTURES;
    if (
      !Number.isSafeInteger(this.#maxQueuedCaptures) ||
      this.#maxQueuedCaptures < 1 ||
      this.#maxQueuedCaptures > 100
    ) {
      throw new TypeError('maxQueuedCaptures must be an integer between 1 and 100.');
    }
    this.#runner = options.runner ?? createDefaultRunner(options);
    this.#onDiagnostic = options.onDiagnostic;
  }

  get activeJobId(): string | undefined {
    return this.#activeJobId;
  }

  get queuedCaptureCount(): number {
    return this.#queue.length;
  }

  /** 不传 sender ID 时供主进程直接取消；传入时只允许取消该页面创建的任务。 */
  cancel(senderWebContentsId?: number): boolean {
    let cancelled = false;
    if (
      this.#activeJobId &&
      (senderWebContentsId === undefined ||
        this.#activeSenderWebContentsId === senderWebContentsId)
    ) {
      cancelled = this.#cancelActive?.() ?? false;
    }

    // Renderer 销毁时同时移除它尚未启动的任务，避免无主 Overlay 稍后被唤起。
    if (senderWebContentsId !== undefined) {
      for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
        const queued = this.#queue[index];
        if (queued?.context.senderWebContentsId !== senderWebContentsId) {
          continue;
        }
        this.#queue.splice(index, 1);
        this.#finishDiagnosticStage(
          queued.jobId,
          'queue',
          'cancel',
          queued.queuedAt,
          queued.context,
          undefined,
          { queueDepth: this.#queue.length }
        );
        queued.resolve({ status: 'cancelled' });
        cancelled = true;
      }
    }
    return cancelled;
  }

  capture(
    options: ScreenshotOptions = {},
    context: ScreenshotJobContext = {}
  ): Promise<ScreenshotResult> {
    if (this.#activeJobId) {
      return this.#handleBusyCapture(options, context);
    }

    return this.#executeCapture(options, context);
  }

  #handleBusyCapture(
    options: ScreenshotOptions,
    context: ScreenshotJobContext
  ): Promise<ScreenshotResult> {
    const senderWebContentsId = context.senderWebContentsId;
    const sameSenderAlreadyPending =
      senderWebContentsId !== undefined &&
      (this.#activeSenderWebContentsId === senderWebContentsId ||
        this.#queue.some(
          (queued) => queued.context.senderWebContentsId === senderWebContentsId
        ));
    if (
      this.#busyPolicy === 'reject' ||
      sameSenderAlreadyPending ||
      this.#queue.length >= this.#maxQueuedCaptures
    ) {
      const result: ScreenshotResult = {
        status: 'failed',
        code: 'CAPTURE_BUSY',
        message: sameSenderAlreadyPending
          ? 'This window already has a screenshot task pending.'
          : 'A screenshot task is already running.',
      };
      const timestamp = Date.now();
      this.#emitDiagnostic({
        jobId: randomUUID(),
        stage: 'queue',
        phase: 'error',
        timestamp,
        durationMs: 0,
        ...(senderWebContentsId === undefined ? {} : { senderWebContentsId }),
        code: result.code,
        message: result.message,
        context: {
          queueDepth: this.#queue.length,
          reason: sameSenderAlreadyPending
            ? 'sender-mutex'
            : this.#busyPolicy === 'reject'
              ? 'policy'
              : 'queue-capacity',
        },
      });
      return Promise.resolve(result);
    }

    return new Promise((resolve) => {
      const jobId = randomUUID();
      const queuedAt = Date.now();
      this.#queue.push({ jobId, queuedAt, options, context, resolve });
      this.#emitDiagnostic({
        jobId,
        stage: 'queue',
        phase: 'start',
        timestamp: queuedAt,
        ...(senderWebContentsId === undefined ? {} : { senderWebContentsId }),
        context: { queueDepth: this.#queue.length },
      });
    });
  }

  async #executeCapture(
    options: ScreenshotOptions,
    context: ScreenshotJobContext,
    jobId: string = randomUUID()
  ): Promise<ScreenshotResult> {
    const startedAt = Date.now();
    this.#activeJobId = jobId;
    this.#activeSenderWebContentsId = context.senderWebContentsId;
    this.#emitDiagnostic({
      jobId,
      stage: 'session',
      phase: 'start',
      timestamp: startedAt,
      ...(context.senderWebContentsId === undefined
        ? {}
        : { senderWebContentsId: context.senderWebContentsId }),
    });

    let result: ScreenshotResult;
    try {
      const execution = this.#runner(jobId, options, context);
      if (isScreenshotExecution(execution)) {
        this.#cancelActive = execution.cancel;
        result = await execution.result;
      } else {
        result = await execution;
      }
    } catch (error) {
      result = toScreenshotFailure(error);
    }

    this.#finishDiagnosticStage(
      jobId,
      'session',
      diagnosticPhaseForResult(result),
      startedAt,
      context,
      result,
      { status: result.status }
    );
    if (this.#activeJobId === jobId) {
      this.#activeJobId = undefined;
      this.#activeSenderWebContentsId = undefined;
      this.#cancelActive = undefined;
      this.#startNextQueuedCapture();
    }
    return result;
  }

  #startNextQueuedCapture(): void {
    const next = this.#queue.shift();
    if (!next) {
      return;
    }
    this.#finishDiagnosticStage(
      next.jobId,
      'queue',
      'complete',
      next.queuedAt,
      next.context,
      undefined,
      { queueDepth: this.#queue.length }
    );
    void this.#executeCapture(next.options, next.context, next.jobId).then(
      next.resolve
    );
  }

  #finishDiagnosticStage(
    jobId: string,
    stage: ScreenshotDiagnosticStage,
    phase: Exclude<ScreenshotDiagnosticPhase, 'start'>,
    startedAt: number,
    context: ScreenshotJobContext,
    result?: ScreenshotResult,
    diagnosticContext?: Readonly<Record<string, ScreenshotDiagnosticContextValue>>
  ): void {
    const timestamp = Date.now();
    this.#emitDiagnostic({
      jobId,
      stage,
      phase,
      timestamp,
      durationMs: Math.max(0, timestamp - startedAt),
      ...(context.senderWebContentsId === undefined
        ? {}
        : { senderWebContentsId: context.senderWebContentsId }),
      ...(result?.status === 'failed'
        ? { code: result.code, message: result.message }
        : {}),
      ...(diagnosticContext ? { context: diagnosticContext } : {}),
    });
  }

  #emitDiagnostic(event: ScreenshotDiagnosticEvent): void {
    emitScreenshotDiagnostic(this.#onDiagnostic, event);
  }
}

function isScreenshotExecution(
  value: Promise<ScreenshotResult> | ScreenshotExecution
): value is ScreenshotExecution {
  return 'result' in value && typeof value.cancel === 'function';
}

function diagnosticPhaseForResult(
  result: ScreenshotResult
): Exclude<ScreenshotDiagnosticPhase, 'start'> {
  return result.status === 'failed'
    ? 'error'
    : result.status === 'cancelled'
      ? 'cancel'
      : 'complete';
}
