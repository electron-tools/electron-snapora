import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import type {
  ScreenshotOutputPayload,
  ScreenshotOutputResponse,
} from '../protocol/messages.js';
import { isOutputPayload } from '../protocol/validators.js';

export interface ScreenshotOutputContext {
  senderWebContentsId: number;
}

export type ScreenshotOutputHandler = (
  payload: ScreenshotOutputPayload,
  context: ScreenshotOutputContext
) => Promise<ScreenshotOutputResponse>;

type OutputIpcMain = Pick<IpcMain, 'handle'>;

interface ActiveOutputHandler {
  jobId: string;
  handler: ScreenshotOutputHandler;
}

/**
 * ipcMain.handle 是进程级单例注册；Router 按 Overlay WebContents 分发活动任务，
 * 避免多个 ScreenshotManager 重复注册同一 channel。
 */
export class ScreenshotOutputRouter {
  readonly #handlers = new Map<number, ActiveOutputHandler>();

  constructor(ipcMain: OutputIpcMain) {
    ipcMain.handle(OVERLAY_CHANNELS.output, this.#handleOutput);
  }

  register(
    senderWebContentsId: number,
    jobId: string,
    handler: ScreenshotOutputHandler
  ): () => void {
    this.#handlers.set(senderWebContentsId, { jobId, handler });
    return () => {
      const current = this.#handlers.get(senderWebContentsId);
      if (current?.jobId === jobId) {
        this.#handlers.delete(senderWebContentsId);
      }
    };
  }

  #handleOutput = async (
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<ScreenshotOutputResponse> => {
    if (!isOutputPayload(payload)) {
      return {
        status: 'failed',
        code: 'INVALID_REQUEST',
        message: 'Invalid or oversized screenshot output request.',
      };
    }

    const active = this.#handlers.get(event.sender.id);
    if (!active || active.jobId !== payload.jobId) {
      return {
        status: 'failed',
        code: 'INVALID_REQUEST',
        message: 'Screenshot output task is not active.',
      };
    }

    try {
      return await active.handler(payload, {
        senderWebContentsId: event.sender.id,
      });
    } catch (error) {
      return {
        status: 'failed',
        code: 'EXPORT_FAILED',
        message: error instanceof Error ? error.message : 'Screenshot output failed.',
      };
    }
  };
}

const routers = new WeakMap<object, ScreenshotOutputRouter>();

export function getScreenshotOutputRouter(
  ipcMain: OutputIpcMain
): ScreenshotOutputRouter {
  const key = ipcMain as object;
  const existing = routers.get(key);
  if (existing) {
    return existing;
  }

  const router = new ScreenshotOutputRouter(ipcMain);
  routers.set(key, router);
  return router;
}
