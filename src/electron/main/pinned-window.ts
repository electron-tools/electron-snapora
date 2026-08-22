import { BrowserWindow } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';

import type { ScreenshotImageResult, ScreenshotOptions } from '../../types.js';
import {
  DEFAULT_SCREENSHOT_LOCALE,
  resolveScreenshotMessages,
} from '../../overlay/presentation.js';
import { PINNED_CHANNELS } from '../protocol/channels.js';
import type { PinnedPoint } from '../preload/pinned-preload.js';
import {
  assertPinnedResources,
  resolvePinnedResources,
  type PackagedResourceExists,
  type PinnedResources,
} from './resource-paths.js';
import {
  copyPngToClipboard,
  createSuggestedName,
  savePngWithDialog,
} from './image-output.js';

export interface PinnedWindowManagerOptions {
  resources?: PinnedResources;
  createWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  resourceExists?: PackagedResourceExists;
}

interface DragState {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export class PinnedWindowManager {
  readonly #resources: PinnedResources;
  readonly #createWindow: NonNullable<PinnedWindowManagerOptions['createWindow']>;
  readonly #windows = new Set<BrowserWindow>();

  constructor(options: PinnedWindowManagerOptions = {}) {
    this.#resources =
      options.resources ?? resolvePinnedResources(undefined, options.resourceExists);
    assertPinnedResources(this.#resources, options.resourceExists);
    this.#createWindow =
      options.createWindow ?? ((windowOptions) => new BrowserWindow(windowOptions));
  }

  get count(): number {
    return this.#windows.size;
  }

  async pin(
    result: ScreenshotImageResult,
    options: ScreenshotOptions = {}
  ): Promise<void> {
    const bounds = {
      x: Math.round(result.bounds.x),
      y: Math.round(result.bounds.y),
      width: Math.max(1, Math.round(result.bounds.width)),
      height: Math.max(1, Math.round(result.bounds.height)),
    };
    const window = this.#createWindow({
      ...bounds,
      // 固定截图直接使用外框尺寸，避免 Windows 阴影反复换算内容尺寸并放大窗口。
      frame: false,
      hasShadow: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      backgroundColor: '#111111',
      show: false,
      webPreferences: {
        preload: this.#resources.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        zoomFactor: 1,
      },
    });
    const data = Uint8Array.from(result.data);
    let dragState: DragState | undefined;

    this.#windows.add(window);
    window.on('closed', () => this.#windows.delete(window));
    window.on('focus', () => window.moveTop());
    window.webContents.on('ipc-message', (_event, channel, ...args) => {
      const point = args[0];
      if (channel === PINNED_CHANNELS.copy) {
        copyPngToClipboard(data);
        // 避免在 Renderer→Main 的 ipc-message 调用栈内重入回发导致确认消息丢失。
        setImmediate(() => {
          if (!window.isDestroyed()) {
            window.webContents.send(PINNED_CHANNELS.copied);
          }
        });
      } else if (channel === PINNED_CHANNELS.save) {
        void savePngWithDialog(data, createSuggestedName(), window);
      } else if (channel === PINNED_CHANNELS.close) {
        window.close();
      } else if (channel === PINNED_CHANNELS.dragStart && isPinnedPoint(point)) {
        const current = window.getBounds();
        dragState = {
          offsetX: point.x - current.x,
          offsetY: point.y - current.y,
          // 始终使用截图原始尺寸，不能把高 DPI 回读后的向上取整值再次写回。
          width: bounds.width,
          height: bounds.height,
        };
        window.focus();
        window.moveTop();
      } else if (
        channel === PINNED_CHANNELS.dragMove &&
        dragState &&
        isPinnedPoint(point)
      ) {
        // Windows 长按拖动时显式锁定初始尺寸，避免高 DPI 坐标换算累积放大窗口。
        window.setBounds(
          {
            x: Math.round(point.x - dragState.offsetX),
            y: Math.round(point.y - dragState.offsetY),
            width: dragState.width,
            height: dragState.height,
          },
          false
        );
      } else if (channel === PINNED_CHANNELS.dragEnd) {
        dragState = undefined;
      }
    });

    try {
      await window.loadFile(this.#resources.htmlPath);
      if (window.isDestroyed()) {
        return;
      }
      window.webContents.send(PINNED_CHANNELS.initialize, {
        data,
        mimeType: 'image/png',
        locale: options.locale ?? DEFAULT_SCREENSHOT_LOCALE,
        menuLabels: getPinnedMenuLabels(options),
      });
      window.show();
      // 窗口可见后再锁回截图外框，吸收 Windows 阴影初始化产生的尺寸结算。
      window.setBounds(bounds, false);
      window.moveTop();
      window.focus();
    } catch (error) {
      this.#windows.delete(window);
      if (!window.isDestroyed()) {
        window.destroy();
      }
      throw error;
    }
  }

  destroyAll(): void {
    for (const window of this.#windows) {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    }
    this.#windows.clear();
  }
}

function isPinnedPoint(value: unknown): value is PinnedPoint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const point = value as Partial<PinnedPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** 固定窗口复用宿主截图文案，避免系统语言与宿主运行时语言不一致。 */
function getPinnedMenuLabels(options: ScreenshotOptions): {
  actions: string;
  copy: string;
  copied: string;
  save: string;
  close: string;
} {
  const messages = resolveScreenshotMessages(options.locale, options.messages);
  return {
    actions: messages.actions,
    copy: messages.copy,
    copied: messages.copied,
    save: messages.save,
    close: messages.close,
  };
}
