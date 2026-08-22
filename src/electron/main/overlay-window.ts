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
  | 'hide'
  | 'isDestroyed'
  | 'loadFile'
  | 'moveTop'
  | 'on'
  | 'removeListener'
  | 'setAlwaysOnTop'
  | 'setBounds'
  | 'setIgnoreMouseEvents'
  | 'setOpacity'
  | 'setVisibleOnAllWorkspaces'
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
  readonly rendererReady?: boolean;
  load(): Promise<void>;
  sendInitialize(payload: ScreenshotInitializePayload): void;
  prime(): void;
  reveal(): void;
  hide?(): void;
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
  readonly #display: CaptureDisplay;
  readonly #bounds: CaptureDisplay['bounds'];
  readonly #platform: NodeJS.Platform;
  readonly #supportsInvisiblePriming: boolean;
  #primed = false;
  #rendererReady = false;
  #loadPromise: Promise<void> | undefined;
  #feedbackWindow: OverlayBrowserWindow | undefined;
  #feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: OverlayWindowOptions) {
    this.#resources =
      options.resources ?? resolveOverlayResources(undefined, options.resourceExists);
    assertOverlayResources(this.#resources, options.resourceExists);
    this.#createWindow =
      options.createWindow ?? ((windowOptions) => new BrowserWindow(windowOptions));
    this.#display = options.display;
    const { bounds } = this.#display;
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
      // macOS 简易全屏要求窗口具备全屏能力；无边框窗口没有可供用户切换的系统按钮。
      fullscreenable: this.#platform === 'darwin',
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: false,
      show: false,
      opacity: this.#supportsInvisiblePriming ? 0 : 1,
      paintWhenInitiallyHidden: true,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      ...(this.#platform === 'win32'
        ? { roundedCorners: false, thickFrame: false }
        : {}),
      ...(this.#platform === 'darwin'
        ? {
            enableLargerThanScreen: true,
            hiddenInMissionControl: true,
            simpleFullscreen: true,
          }
        : {}),
      webPreferences: {
        preload: this.#resources.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        zoomFactor: 1,
      },
    });
    this.#window.webContents.on('ipc-message', (_event, channel) => {
      if (channel === OVERLAY_CHANNELS.ready) {
        this.#rendererReady = true;
      }
    });
    this.#configureMacWorkspaceVisibility(this.#window);
  }

  get webContentsId(): number {
    return this.#window.webContents.id;
  }

  get rendererReady(): boolean {
    return this.#rendererReady;
  }

  load(): Promise<void> {
    this.#loadPromise ??= this.#window.loadFile(this.#resources.htmlPath);
    return this.#loadPromise;
  }

  /** 只复用同一块、几何信息未变化的屏幕，避免跨 Space 或缩放变化造成偏移。 */
  matchesDisplay(display: CaptureDisplay): boolean {
    const bounds = display.bounds;
    return (
      !this.#window.isDestroyed() &&
      display.id === this.#display.id &&
      display.scaleFactor === this.#display.scaleFactor &&
      bounds.x === this.#bounds.x &&
      bounds.y === this.#bounds.y &&
      bounds.width === this.#bounds.width &&
      bounds.height === this.#bounds.height
    );
  }

  sendInitialize(payload: ScreenshotInitializePayload): void {
    this.#window.webContents.send(OVERLAY_CHANNELS.initialize, payload);
  }

  /** 先以全透明状态进入桌面合成器，隐藏 Windows/macOS 的窗口出场和大图首帧栅格化。 */
  prime(): void {
    if (!this.#window.isDestroyed() && this.#supportsInvisiblePriming) {
      this.#raiseAboveOtherWindows();
      this.#window.showInactive();
      if (this.#platform !== 'darwin') {
        // Windows 会在首次显示时把无边框窗口压到 workArea；显示后重设 bounds 才能覆盖任务栏。
        this.#window.setBounds(this.#bounds, false);
      }
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

  /** 保留已加载的 renderer，但立即退出桌面合成和截图画面。 */
  hide(): void {
    this.#destroyFeedbackWindow();
    if (this.#window.isDestroyed()) {
      return;
    }
    if (this.#supportsInvisiblePriming) {
      this.#window.setOpacity(0);
    }
    this.#window.hide();
    this.#primed = false;
  }

  /** 复制完成后隐藏全屏截图层，改用独立的小窗口显示鼠标穿透提示。 */
  showCopyFeedback(durationMs: number, options: ScreenshotOptions): void {
    this.hide();

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
    this.#configureMacWorkspaceVisibility(feedbackWindow);
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

  /** 让截图层和复制提示在 macOS 全屏 Space 中也保持可见。 */
  #configureMacWorkspaceVisibility(window: OverlayBrowserWindow): void {
    if (this.#platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
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
