import { BrowserWindow } from 'electron';
import type { BrowserWindowConstructorOptions, WebContents } from 'electron';
import type { ScreenshotOptions } from '../../types.js';

import type {
  CaptureDisplay,
  ScreenshotInitializePayload,
} from '../protocol/messages.js';
import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import {
  assertOverlayResources,
  resolveOverlayResources,
  type OverlayResources,
  type PackagedResourceExists,
} from './resource-paths.js';

export type OverlayBrowserWindow = Pick<
  BrowserWindow,
  | 'destroy'
  | 'focus'
  | 'isDestroyed'
  | 'loadFile'
  | 'moveTop'
  | 'on'
  | 'removeListener'
  | 'setAlwaysOnTop'
  | 'setBounds'
  | 'setIgnoreMouseEvents'
  | 'setOpacity'
  | 'show'
  | 'showInactive'
> & {
  webContents: Pick<WebContents, 'id' | 'on' | 'removeListener' | 'send'>;
};

export type OverlayBrowserWindowFactory = (
  options: BrowserWindowConstructorOptions
) => OverlayBrowserWindow;

export interface OverlayWindowOptions {
  display: CaptureDisplay;
  resources?: OverlayResources;
  createWindow?: OverlayBrowserWindowFactory;
  platform?: NodeJS.Platform;
  resourceExists?: PackagedResourceExists;
}

export interface ScreenshotOverlayWindow {
  readonly webContentsId: number;
  load(): Promise<void>;
  sendInitialize(payload: ScreenshotInitializePayload): void;
  prime(): void;
  reveal(): void;
  showCopyFeedback?(durationMs: number, options: ScreenshotOptions): void;
  destroy(): void;
  onClosed(listener: () => void): () => void;
  onRendererGone(listener: () => void): () => void;
}

/** 管理包内截图窗口，窗口始终使用隔离上下文且不向页面开放 Node.js。 */
export class OverlayWindow implements ScreenshotOverlayWindow {
  readonly #resources: OverlayResources;
  readonly #window: OverlayBrowserWindow;
  readonly #createWindow: OverlayBrowserWindowFactory;
  readonly #bounds: CaptureDisplay['bounds'];
  readonly #platform: NodeJS.Platform;
  readonly #supportsInvisiblePriming: boolean;
  #primed = false;
  #feedbackWindow: OverlayBrowserWindow | undefined;
  #feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: OverlayWindowOptions) {
    this.#resources =
      options.resources ?? resolveOverlayResources(undefined, options.resourceExists);
    assertOverlayResources(this.#resources, options.resourceExists);
    this.#createWindow =
      options.createWindow ?? ((windowOptions) => new BrowserWindow(windowOptions));
    const { bounds } = options.display;
    this.#bounds = bounds;
    this.#platform = options.platform ?? process.platform;
    this.#supportsInvisiblePriming = ['win32', 'darwin'].includes(this.#platform);

    this.#window = this.#createWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      useContentSize: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: false,
      show: false,
      opacity: this.#supportsInvisiblePriming ? 0 : 1,
      paintWhenInitiallyHidden: true,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: this.#resources.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        zoomFactor: 1,
      },
    });
  }

  get webContentsId(): number {
    return this.#window.webContents.id;
  }

  async load(): Promise<void> {
    await this.#window.loadFile(this.#resources.htmlPath);
  }

  sendInitialize(payload: ScreenshotInitializePayload): void {
    this.#window.webContents.send(OVERLAY_CHANNELS.initialize, payload);
  }

  /** 先以全透明状态进入桌面合成器，隐藏 Windows/macOS 的窗口出场和大图首帧栅格化。 */
  prime(): void {
    if (!this.#window.isDestroyed() && this.#supportsInvisiblePriming) {
      this.#raiseAboveOtherWindows();
      this.#window.showInactive();
      // Windows 会在首次显示时把无边框窗口压到 workArea；显示后重设 bounds 才能覆盖任务栏。
      this.#window.setBounds(this.#bounds, false);
      this.#window.moveTop();
      this.#primed = true;
    }
  }

  reveal(): void {
    if (this.#window.isDestroyed()) {
      return;
    }
    this.#raiseAboveOtherWindows();
    if (this.#primed) {
      this.#window.setOpacity(1);
      this.#window.focus();
    } else {
      this.#window.show();
    }
    this.#window.moveTop();
  }

  /** 复制完成后销毁全屏截图层，改用独立的小窗口显示鼠标穿透提示。 */
  showCopyFeedback(durationMs: number, options: ScreenshotOptions): void {
    if (!this.#window.isDestroyed()) {
      this.#window.destroy();
    }
    this.#destroyFeedbackWindow();

    const width = Math.min(360, this.#bounds.width);
    const height = Math.min(72, this.#bounds.height);
    const feedbackWindow = this.#createWindow({
      x: this.#bounds.x + Math.round((this.#bounds.width - width) / 2),
      y: this.#bounds.y + Math.min(24, Math.max(0, this.#bounds.height - height)),
      width,
      height,
      useContentSize: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      show: false,
      paintWhenInitiallyHidden: true,
      autoHideMenuBar: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.#resources.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        zoomFactor: 1,
      },
    });
    this.#feedbackWindow = feedbackWindow;
    feedbackWindow.setIgnoreMouseEvents(true);

    const handleIpcMessage = (_event: unknown, channel: string): void => {
      if (channel !== OVERLAY_CHANNELS.feedbackReady) {
        return;
      }
      feedbackWindow.webContents.removeListener('ipc-message', handleIpcMessage);
      if (feedbackWindow.isDestroyed() || this.#feedbackWindow !== feedbackWindow) {
        return;
      }
      this.#clearFeedbackTimer();
      this.#raiseAboveOtherWindows(feedbackWindow);
      feedbackWindow.showInactive();
      feedbackWindow.moveTop();
      this.#feedbackTimer = setTimeout(
        () => this.#destroyFeedbackWindow(feedbackWindow),
        durationMs
      );
      this.#feedbackTimer.unref?.();
    };
    feedbackWindow.webContents.on('ipc-message', handleIpcMessage);

    // 如果反馈渲染进程异常，隐藏窗口最多保留两秒，避免后台泄漏。
    this.#feedbackTimer = setTimeout(
      () => this.#destroyFeedbackWindow(feedbackWindow),
      2_000
    );
    this.#feedbackTimer.unref?.();
    void feedbackWindow
      .loadFile(this.#resources.htmlPath)
      .then(() => {
        if (!feedbackWindow.isDestroyed() && this.#feedbackWindow === feedbackWindow) {
          feedbackWindow.webContents.send(OVERLAY_CHANNELS.feedback, {
            kind: 'copy',
            durationMs,
            options,
          });
        }
      })
      .catch(() => this.#destroyFeedbackWindow(feedbackWindow));
  }

  /** 截图层必须高于普通置顶窗口；Windows/macOS 使用系统支持的最高标准层级。 */
  #raiseAboveOtherWindows(window = this.#window): void {
    if (this.#platform === 'win32' || this.#platform === 'darwin') {
      window.setAlwaysOnTop(true, 'screen-saver');
      return;
    }
    window.setAlwaysOnTop(true);
  }

  destroy(): void {
    this.#destroyFeedbackWindow();
    if (!this.#window.isDestroyed()) {
      this.#window.destroy();
    }
  }

  #clearFeedbackTimer(): void {
    if (this.#feedbackTimer) {
      clearTimeout(this.#feedbackTimer);
      this.#feedbackTimer = undefined;
    }
  }

  #destroyFeedbackWindow(window = this.#feedbackWindow): void {
    this.#clearFeedbackTimer();
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
    if (this.#feedbackWindow === window) {
      this.#feedbackWindow = undefined;
    }
  }

  onClosed(listener: () => void): () => void {
    this.#window.on('closed', listener);
    return () => {
      if (!this.#window.isDestroyed()) {
        this.#window.removeListener('closed', listener);
      }
    };
  }

  onRendererGone(listener: () => void): () => void {
    const handleGone = () => {
      listener();
    };

    this.#window.webContents.on('render-process-gone', handleGone);
    return () => {
      // closed 事件触发时 WebContents 已销毁，不能再访问其 EventEmitter。
      if (!this.#window.isDestroyed()) {
        this.#window.webContents.removeListener('render-process-gone', handleGone);
      }
    };
  }
}
