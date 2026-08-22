import type { IpcMain, IpcMainInvokeEvent } from 'electron';

import type { ScreenshotResult } from '../../types.js';
import {
  DEFAULT_HOST_CANCEL_CHANNEL,
  DEFAULT_HOST_CAPTURE_CHANNEL,
} from '../protocol/channels.js';
import { parseScreenshotOptions } from '../protocol/validators.js';
import { resolveHostPreloadPath } from './resource-paths.js';
import {
  ScreenshotManager,
  type ScreenshotManagerOptions,
} from './screenshot-manager.js';

export type ValidateScreenshotIpcSender = (event: IpcMainInvokeEvent) => boolean;

export interface RegisterScreenshotIpcOptions {
  ipcMain: IpcMain;
  manager: ScreenshotManager;
  channel?: string;
  cancelChannel?: string;
  validateSender?: ValidateScreenshotIpcSender;
}

export interface SetupElectronSnaporaOptions extends Omit<
  RegisterScreenshotIpcOptions,
  'manager'
> {
  managerOptions?: ScreenshotManagerOptions;
}

export interface SetupElectronSnaporaResult {
  manager: ScreenshotManager;
  preloadPath: string;
  unregister: () => void;
}

/**
 * 创建默认截图管理器、注册宿主 IPC，并返回可直接交给 BrowserWindow 的 Preload 路径。
 * 高级宿主仍可分别使用 ScreenshotManager 和 registerScreenshotIpc。
 */
export function setupElectronSnapora(
  options: SetupElectronSnaporaOptions
): SetupElectronSnaporaResult {
  const { managerOptions, ...ipcOptions } = options;
  const manager = new ScreenshotManager(managerOptions);
  const unregisterIpc = registerScreenshotIpc({ ...ipcOptions, manager });

  return {
    manager,
    preloadPath: resolveHostPreloadPath(),
    unregister() {
      unregisterIpc();
      manager.dispose();
    },
  };
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
