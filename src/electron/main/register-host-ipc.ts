import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import type { ScreenshotResult } from '../../types.js';
import {
  DEFAULT_HOST_CANCEL_CHANNEL,
  DEFAULT_HOST_CAPTURE_CHANNEL,
} from '../protocol/channels.js';
import { parseScreenshotOptions } from '../protocol/validators.js';
import type { ScreenshotManager } from './screenshot-manager.js';

export type ValidateScreenshotIpcSender = (event: IpcMainInvokeEvent) => boolean;

export interface RegisterScreenshotIpcOptions {
  ipcMain: IpcMain;
  manager: ScreenshotManager;
  channel?: string;
  cancelChannel?: string;
  validateSender?: ValidateScreenshotIpcSender;
}

/** 注册宿主渲染进程调用入口，并返回可用于应用退出或热重载的清理函数。 */
export function registerScreenshotIpc(
  options: RegisterScreenshotIpcOptions
): () => void {
  const channel = options.channel ?? DEFAULT_HOST_CAPTURE_CHANNEL;
  const cancelChannel =
    options.cancelChannel ??
    (options.channel ? `${options.channel}:cancel` : DEFAULT_HOST_CANCEL_CHANNEL);

  options.ipcMain.handle(channel, async (event, captureOptions: unknown) => {
    if (!isAuthorizedSender(event, options.validateSender)) {
      return invalidRequest('The screenshot request sender is not authorized.');
    }

    const parsed = parseScreenshotOptions(captureOptions);
    if (!parsed.success) {
      return invalidRequest(parsed.message);
    }

    const senderWebContentsId = event.sender.id;
    const cancelWhenDestroyed = (): void => {
      options.manager.cancel(senderWebContentsId);
    };
    event.sender.once('destroyed', cancelWhenDestroyed);
    try {
      return await options.manager.capture(parsed.value, { senderWebContentsId });
    } finally {
      event.sender.removeListener('destroyed', cancelWhenDestroyed);
    }
  });

  options.ipcMain.handle(cancelChannel, async (event) => {
    if (!isAuthorizedSender(event, options.validateSender)) {
      return false;
    }
    return options.manager.cancel(event.sender.id);
  });

  return () => {
    options.ipcMain.removeHandler(channel);
    options.ipcMain.removeHandler(cancelChannel);
  };
}

/** iframe 永远不能授权；默认仅允许 loadFile() 创建的本地顶层页面。 */
function isAuthorizedSender(
  event: IpcMainInvokeEvent,
  validateSender: ValidateScreenshotIpcSender | undefined
): boolean {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    return false;
  }

  if (validateSender) {
    try {
      return validateSender(event);
    } catch {
      return false;
    }
  }

  try {
    return new URL(event.senderFrame.url).protocol === 'file:';
  } catch {
    return false;
  }
}

function invalidRequest(message: string): ScreenshotResult {
  return { status: 'failed', code: 'INVALID_REQUEST', message };
}
