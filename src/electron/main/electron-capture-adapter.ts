import { desktopCapturer, screen, shell, systemPreferences } from 'electron';

import type { ScreenshotOptions } from '../../types.js';
import type {
  CaptureDisplay,
  CapturedFrame,
  ScreenCaptureAdapter,
} from '../protocol/messages.js';
import {
  findCapturedFrameLimitViolation,
  resolveScreenshotResourceLimits,
  type ScreenshotResourceLimitOptions,
  type ScreenshotResourceLimits,
} from '../protocol/limits.js';
import { ScreenshotError } from './errors.js';

interface ElectronDisplayLike {
  id: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
}

interface ScreenApi {
  getAllDisplays(): ElectronDisplayLike[];
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayNearestPoint(point: { x: number; y: number }): ElectronDisplayLike;
  getPrimaryDisplay(): ElectronDisplayLike;
}

interface DesktopCaptureSource {
  display_id: string;
  thumbnail: {
    getSize(): { width: number; height: number };
    isEmpty(): boolean;
    toDataURL(): string;
  };
}

interface DesktopCapturerApi {
  getSources(options: {
    types: Array<'screen'>;
    thumbnailSize: { width: number; height: number };
    fetchWindowIcons: boolean;
  }): Promise<DesktopCaptureSource[]>;
}

type ScreenPermissionStatus =
  'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

/** macOS 已拒绝屏幕录制后不会再次弹授权框，只能进入隐私设置手动开启。 */
const MAC_SCREEN_CAPTURE_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

export interface ElectronCaptureAdapterOptions {
  desktopCapturer?: DesktopCapturerApi;
  screen?: ScreenApi;
  platform?: NodeJS.Platform;
  getScreenPermissionStatus?: () => ScreenPermissionStatus;
  openScreenCaptureSettings?: () => Promise<void> | void;
  resourceLimits?: ScreenshotResourceLimitOptions;
}

/**
 * Electron 默认屏幕采集实现。适配器只依赖长期稳定的 Electron API，
 * 采集结果转换为普通数据结构后再交给 Overlay，避免 UI 直接持有 NativeImage。
 */
export class ElectronCaptureAdapter implements ScreenCaptureAdapter {
  readonly #desktopCapturer: DesktopCapturerApi;
  readonly #screen: ScreenApi;
  readonly #platform: NodeJS.Platform;
  readonly #getScreenPermissionStatus: () => ScreenPermissionStatus;
  readonly #openScreenCaptureSettings: () => Promise<void> | void;
  readonly #resourceLimits: ScreenshotResourceLimits;

  constructor(options: ElectronCaptureAdapterOptions = {}) {
    this.#desktopCapturer = options.desktopCapturer ?? desktopCapturer;
    this.#screen = options.screen ?? screen;
    this.#platform = options.platform ?? process.platform;
    this.#getScreenPermissionStatus =
      options.getScreenPermissionStatus ??
      (() => systemPreferences.getMediaAccessStatus('screen'));
    this.#openScreenCaptureSettings =
      options.openScreenCaptureSettings ??
      (() => shell.openExternal(MAC_SCREEN_CAPTURE_SETTINGS_URL));
    this.#resourceLimits = resolveScreenshotResourceLimits(options.resourceLimits);
  }

  resolveTargetDisplay(options: ScreenshotOptions = {}): CaptureDisplay {
    return this.#toCaptureDisplay(this.#resolveDisplay(options.display ?? 'cursor'));
  }

  async capture(
    options: ScreenshotOptions = {},
    targetDisplay?: CaptureDisplay
  ): Promise<CapturedFrame[]> {
    await this.#ensurePermission();

    // Session 预加载 Overlay 后必须继续使用同一个显示器，不能再次按鼠标位置解析。
    const display = targetDisplay
      ? this.#resolveDisplay(targetDisplay.id)
      : this.#resolveDisplay(options.display ?? 'cursor');
    const pixelSize = {
      width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
    };
    this.#assertRequestedPixelSize(pixelSize);

    let sources: DesktopCaptureSource[];
    try {
      sources = await this.#desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: pixelSize,
        fetchWindowIcons: false,
      });
    } catch (error) {
      // macOS 首次请求可能先显示系统授权弹窗，失败后状态才变为 denied。
      await this.#ensurePermission();
      throw new ScreenshotError(
        'CAPTURE_FAILED',
        'Electron failed to capture the screen.',
        {
          cause: error,
        }
      );
    }
    await this.#ensurePermission();

    const source = sources.find(
      (candidate) => candidate.display_id === String(display.id)
    );
    if (!source) {
      await this.#ensurePermission();
      throw new ScreenshotError(
        'DISPLAY_NOT_FOUND',
        `No desktop capture source matched display ${display.id}.`
      );
    }

    if (source.thumbnail.isEmpty()) {
      await this.#ensurePermission();
      throw new ScreenshotError(
        'CAPTURE_FAILED',
        'Electron returned an empty screen image.'
      );
    }

    const actualPixelSize = source.thumbnail.getSize();
    if (actualPixelSize.width <= 0 || actualPixelSize.height <= 0) {
      throw new ScreenshotError(
        'CAPTURE_FAILED',
        'Electron returned an invalid screen image size.'
      );
    }

    const frame = {
      display: this.#toCaptureDisplay(display),
      dataUrl: source.thumbnail.toDataURL(),
      pixelSize: actualPixelSize,
    };
    const violation = findCapturedFrameLimitViolation(frame, this.#resourceLimits);
    if (violation) {
      throw new ScreenshotError('RESOURCE_LIMIT_EXCEEDED', violation);
    }
    return [frame];
  }

  #assertRequestedPixelSize(pixelSize: { width: number; height: number }): void {
    if (pixelSize.width * pixelSize.height > this.#resourceLimits.maxCapturePixels) {
      throw new ScreenshotError(
        'RESOURCE_LIMIT_EXCEEDED',
        `Requested capture exceeds the ${this.#resourceLimits.maxCapturePixels} pixel limit.`
      );
    }
  }

  async #ensurePermission(): Promise<void> {
    if (this.#platform !== 'darwin') {
      return;
    }

    const status = this.#getScreenPermissionStatus();
    if (status === 'denied' || status === 'restricted') {
      if (status === 'denied') {
        try {
          await this.#openScreenCaptureSettings();
        } catch {
          // 打开系统设置失败不能掩盖真正的权限错误。
        }
      }
      throw new ScreenshotError(
        'PERMISSION_DENIED',
        'Screen recording permission is required to capture the display.'
      );
    }
  }

  #resolveDisplay(
    requestedDisplay: NonNullable<ScreenshotOptions['display']>
  ): ElectronDisplayLike {
    if (requestedDisplay === 'cursor') {
      return this.#screen.getDisplayNearestPoint(this.#screen.getCursorScreenPoint());
    }

    if (requestedDisplay === 'primary') {
      return this.#screen.getPrimaryDisplay();
    }

    const display = this.#screen
      .getAllDisplays()
      .find((candidate) => String(candidate.id) === requestedDisplay);
    if (!display) {
      throw new ScreenshotError(
        'DISPLAY_NOT_FOUND',
        `Display ${requestedDisplay} is not available.`
      );
    }

    return display;
  }

  #toCaptureDisplay(display: ElectronDisplayLike): CaptureDisplay {
    return {
      id: String(display.id),
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
    };
  }
}
