import { randomUUID } from 'node:crypto';

import { ipcMain as electronIpcMain, webContents } from 'electron';
import type { IpcMain } from 'electron';

import type { ScreenshotOptions, ScreenshotResult } from '../../types.js';
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
}

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
      registerOutputHandler: (senderWebContentsId, activeJobId) =>
        outputRouter.register(
          senderWebContentsId,
          activeJobId,
          (payload, outputContext) => {
            if (payload.result.data.byteLength > resourceLimits.maxOutputBytes) {
              return Promise.resolve({
                status: 'failed',
                code: 'RESOURCE_LIMIT_EXCEEDED',
                message: `Screenshot output exceeds the ${resourceLimits.maxOutputBytes} byte limit.`,
              });
            }
            return outputAdapter.execute(payload, outputContext);
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
  #activeJobId: string | undefined;
  #activeSenderWebContentsId: number | undefined;
  #cancelActive: (() => boolean) | undefined;

  constructor(options: ScreenshotManagerOptions = {}) {
    this.#runner = options.runner ?? createDefaultRunner(options);
  }

  get activeJobId(): string | undefined {
    return this.#activeJobId;
  }

  /** 不传 sender ID 时供主进程直接取消；传入时只允许取消该页面创建的任务。 */
  cancel(senderWebContentsId?: number): boolean {
    if (
      !this.#activeJobId ||
      (senderWebContentsId !== undefined &&
        this.#activeSenderWebContentsId !== senderWebContentsId)
    ) {
      return false;
    }
    return this.#cancelActive?.() ?? false;
  }

  async capture(
    options: ScreenshotOptions = {},
    context: ScreenshotJobContext = {}
  ): Promise<ScreenshotResult> {
    if (this.#activeJobId) {
      return {
        status: 'failed',
        code: 'CAPTURE_BUSY',
        message: 'A screenshot task is already running.',
      };
    }

    const jobId = randomUUID();
    this.#activeJobId = jobId;
    this.#activeSenderWebContentsId = context.senderWebContentsId;

    try {
      const execution = this.#runner(jobId, options, context);
      if (isScreenshotExecution(execution)) {
        this.#cancelActive = execution.cancel;
        return await execution.result;
      }
      return await execution;
    } catch (error) {
      return toScreenshotFailure(error);
    } finally {
      if (this.#activeJobId === jobId) {
        this.#activeJobId = undefined;
        this.#activeSenderWebContentsId = undefined;
        this.#cancelActive = undefined;
      }
    }
  }
}

function isScreenshotExecution(
  value: Promise<ScreenshotResult> | ScreenshotExecution
): value is ScreenshotExecution {
  return 'result' in value && typeof value.cancel === 'function';
}
