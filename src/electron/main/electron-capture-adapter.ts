import { desktopCapturer, screen, systemPreferences } from 'electron';

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

export interface ElectronCaptureAdapterOptions {
  desktopCapturer?: DesktopCapturerApi;
  screen?: ScreenApi;
  platform?: NodeJS.Platform;
  getScreenPermissionStatus?: () => ScreenPermissionStatus;
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
  readonly #resourceLimits: ScreenshotResourceLimits;

  constructor(options: ElectronCaptureAdapterOptions = {}) {
    this.#desktopCapturer = options.desktopCapturer ?? desktopCapturer;
    this.#screen = options.screen ?? screen;
    this.#platform = options.platform ?? process.platform;
    this.#getScreenPermissionStatus =
      options.getScreenPermissionStatus ??
      (() => systemPreferences.getMediaAccessStatus('screen'));
    this.#resourceLimits = resolveScreenshotResourceLimits(options.resourceLimits);
  }

  async capture(options: ScreenshotOptions = {}): Promise<CapturedFrame[]> {
    this.#assertPermission();

    const display = this.#resolveDisplay(options.display ?? 'cursor');
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
      throw new ScreenshotError(
        'CAPTURE_FAILED',
        'Electron failed to capture the screen.',
        {
          cause: error,
        }
      );
    }

    const source = sources.find(
      (candidate) => candidate.display_id === String(display.id)
    );
    if (!source) {
      throw new ScreenshotError(
        'DISPLAY_NOT_FOUND',
        `No desktop capture source matched display ${display.id}.`
      );
    }

    if (source.thumbnail.isEmpty()) {
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

  #assertPermission(): void {
    if (this.#platform !== 'darwin') {
      return;
    }

    const status = this.#getScreenPermissionStatus();
    if (status === 'denied' || status === 'restricted') {
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
