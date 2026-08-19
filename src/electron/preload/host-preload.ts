import type { ContextBridge, IpcRenderer } from 'electron';

import type {
  ScreenshotOptions,
  ScreenshotRendererApi,
  ScreenshotResult,
} from '../../types.js';
import {
  DEFAULT_HOST_CANCEL_CHANNEL,
  DEFAULT_HOST_CAPTURE_CHANNEL,
} from '../protocol/channels.js';

export interface ExposeScreenshotApiOptions {
  contextBridge: ContextBridge;
  ipcRenderer: IpcRenderer;
  globalName?: string;
  channel?: string;
  cancelChannel?: string;
}

/**
 * 将最小截图接口暴露给宿主页面。调用方显式传入 Electron 能力，
 * 使包本身不依赖 remote，也不要求关闭 contextIsolation。
 */
export function exposeScreenshotApi(
  options: ExposeScreenshotApiOptions
): ScreenshotRendererApi {
  const channel = options.channel ?? DEFAULT_HOST_CAPTURE_CHANNEL;
  const cancelChannel =
    options.cancelChannel ??
    (options.channel ? `${options.channel}:cancel` : DEFAULT_HOST_CANCEL_CHANNEL);
  const api: ScreenshotRendererApi = {
    capture: (captureOptions?: ScreenshotOptions) =>
      options.ipcRenderer.invoke(channel, captureOptions) as Promise<ScreenshotResult>,
    cancel: () => options.ipcRenderer.invoke(cancelChannel) as Promise<boolean>,
  };

  options.contextBridge.exposeInMainWorld(options.globalName ?? 'electronSnapora', api);
  return api;
}
