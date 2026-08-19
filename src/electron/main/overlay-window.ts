import { BrowserWindow } from 'electron';
import type { BrowserWindowConstructorOptions, WebContents } from 'electron';

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
  destroy(): void;
  onClosed(listener: () => void): () => void;
  onRendererGone(listener: () => void): () => void;
}

/** 管理包内截图窗口，窗口始终使用隔离上下文且不向页面开放 Node.js。 */
export class OverlayWindow implements ScreenshotOverlayWindow {
  readonly #resources: OverlayResources;
  readonly #window: OverlayBrowserWindow;
  readonly #bounds: CaptureDisplay['bounds'];
  readonly #platform: NodeJS.Platform;
  readonly #supportsInvisiblePriming: boolean;
  #primed = false;

  constructor(options: OverlayWindowOptions) {
    this.#resources =
      options.resources ?? resolveOverlayResources(undefined, options.resourceExists);
    assertOverlayResources(this.#resources, options.resourceExists);
    const createWindow =
      options.createWindow ?? ((windowOptions) => new BrowserWindow(windowOptions));
    const { bounds } = options.display;
    this.#bounds = bounds;
    this.#platform = options.platform ?? process.platform;
    this.#supportsInvisiblePriming = ['win32', 'darwin'].includes(this.#platform);

    this.#window = createWindow({
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

  /** 截图层必须高于普通置顶窗口；Windows/macOS 使用系统支持的最高标准层级。 */
  #raiseAboveOtherWindows(): void {
    if (this.#platform === 'win32' || this.#platform === 'darwin') {
      this.#window.setAlwaysOnTop(true, 'screen-saver');
      return;
    }
    this.#window.setAlwaysOnTop(true);
  }

  destroy(): void {
    if (!this.#window.isDestroyed()) {
      this.#window.destroy();
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
