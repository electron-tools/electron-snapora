import {
  app,
  desktopCapturer,
  powerMonitor,
  screen,
  shell,
  systemPreferences,
} from 'electron';

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
import {
  NativeWindowsScreenCapture,
  type WindowsScreenCapture,
} from './windows-screen-capture.js';

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
  dipToScreenRect?(
    window: null,
    rect: ElectronDisplayLike['bounds']
  ): ElectronDisplayLike['bounds'];
  getAllDisplays(): ElectronDisplayLike[];
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayNearestPoint(point: { x: number; y: number }): ElectronDisplayLike;
  getPrimaryDisplay(): ElectronDisplayLike;
  on?(event: DisplayChangeEvent, listener: DisplayChangeListener): unknown;
  removeListener?(event: DisplayChangeEvent, listener: DisplayChangeListener): unknown;
}

type DisplayChangeListener = (
  event?: unknown,
  display?: ElectronDisplayLike,
  changedMetrics?: string[]
) => void;

type DisplayChangeEvent =
  'display-added' | 'display-removed' | 'display-metrics-changed';
const DISPLAY_CHANGE_EVENTS: DisplayChangeEvent[] = [
  'display-added',
  'display-removed',
  'display-metrics-changed',
];

interface DesktopCaptureSource {
  id: string;
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
  /** Inject the cursor-free Windows live capture process (primarily for tests). */
  windowsCapture?: WindowsScreenCapture;
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
  readonly #desktopSourceIds = new Map<string, string>();
  readonly #desktopSourceFallbacks = new Set<string>();
  #desktopSourceEnumeration: Promise<void> | undefined;
  #sourceRevision = 0;
  #watchingSources = false;
  #disposed = false;
  #windowsCapture: WindowsScreenCapture | undefined;

  constructor(options: ElectronCaptureAdapterOptions = {}) {
    this.#windowsCapture = options.windowsCapture;
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

  async prepare(options: ScreenshotOptions = {}): Promise<void> {
    if (this.#platform === 'win32' && options.interactionMode === 'live') {
      await this.#nativeCapture().prepare();
      return;
    }
    if (this.#platform === 'win32') {
      await this.#enumerateDesktopSources();
    }
  }

  /** 释放默认 Manager 拥有的系统订阅；自定义适配器由宿主释放。 */
  dispose(): void {
    this.#disposed = true;
    this.#windowsCapture?.dispose();
    this.#sourceRevision++;
    this.#desktopSourceIds.clear();
    this.#desktopSourceFallbacks.clear();
    if (this.#watchingSources) {
      for (const event of DISPLAY_CHANGE_EVENTS) {
        this.#screen.removeListener?.(event, this.#invalidateDesktopSources);
      }
      powerMonitor.removeListener('resume', this.#invalidateDesktopSources);
      powerMonitor.removeListener('unlock-screen', this.#invalidateDesktopSources);
      this.#watchingSources = false;
    }
  }

  async capture(
    options: ScreenshotOptions = {},
    targetDisplay?: CaptureDisplay,
    signal?: AbortSignal
  ): Promise<CapturedFrame[]> {
    return this.#capture(options, targetDisplay, this.#platform === 'win32', signal);
  }

  async captureFallback(
    options: ScreenshotOptions,
    targetDisplay: CaptureDisplay,
    signal?: AbortSignal
  ): Promise<CapturedFrame[]> {
    this.#desktopSourceFallbacks.add(targetDisplay.id);
    this.#desktopSourceIds.delete(targetDisplay.id);
    return this.#capture(options, targetDisplay, false, signal);
  }

  async #capture(
    options: ScreenshotOptions,
    targetDisplay: CaptureDisplay | undefined,
    returnDesktopSource: boolean,
    signal?: AbortSignal
  ): Promise<CapturedFrame[]> {
    signal?.throwIfAborted();
    await this.#ensurePermission();
    signal?.throwIfAborted();

    // Session 预加载 Overlay 后必须继续使用同一个显示器，不能再次按鼠标位置解析。
    const display = targetDisplay
      ? this.#resolveDisplay(targetDisplay.id)
      : this.#resolveDisplay(options.display ?? 'cursor');
    const pixelSize = {
      width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
    };
    this.#assertRequestedPixelSize(pixelSize);

    if (this.#platform === 'win32' && options.interactionMode === 'live') {
      const bounds = this.#screen.dipToScreenRect?.(null, display.bounds);
      if (!bounds)
        throw new ScreenshotError(
          'CAPTURE_FAILED',
          'Physical display coordinates are unavailable.'
        );
      this.#assertRequestedPixelSize(bounds);
      const dataUrl = await this.#nativeCapture().capture(
        bounds,
        this.#resourceLimits.maxCaptureDataUrlBytes,
        signal
      );
      signal?.throwIfAborted();
      // Read only the PNG header; decoding a full desktop image here would block main-process input.
      const header = Buffer.from(
        dataUrl.slice(
          'data:image/png;base64,'.length,
          'data:image/png;base64,'.length + 32
        ),
        'base64'
      );
      if (header.length !== 24 || header.toString('ascii', 12, 16) !== 'IHDR')
        throw new ScreenshotError(
          'CAPTURE_FAILED',
          'Native capture returned an invalid PNG header.'
        );
      const frame: CapturedFrame = {
        kind: 'image',
        display: this.#toCaptureDisplay(display),
        pixelSize: { width: header.readUInt32BE(16), height: header.readUInt32BE(20) },
        dataUrl,
      };
      const violation = findCapturedFrameLimitViolation(frame, this.#resourceLimits);
      if (violation) throw new ScreenshotError('RESOURCE_LIMIT_EXCEEDED', violation);
      return [frame];
    }

    const displayId = String(display.id);
    if (returnDesktopSource && !this.#desktopSourceFallbacks.has(displayId)) {
      const sourceId = await this.#resolveDesktopSourceId(displayId);
      if (!sourceId) {
        throw new ScreenshotError(
          'DISPLAY_NOT_FOUND',
          `No desktop capture source matched display ${display.id}.`
        );
      }
      return [
        {
          kind: 'desktop-source',
          display: this.#toCaptureDisplay(display),
          sourceId,
          pixelSize,
        },
      ];
    }

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

    const source = this.#findDisplaySource(sources, displayId);
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

  async #resolveDesktopSourceId(displayId: string): Promise<string | undefined> {
    const cachedSourceId = this.#desktopSourceIds.get(displayId);
    if (cachedSourceId) {
      return cachedSourceId;
    }
    try {
      await this.#enumerateDesktopSources();
    } catch (error) {
      throw new ScreenshotError(
        'CAPTURE_FAILED',
        'Electron failed to enumerate desktop capture sources.',
        { cause: error }
      );
    }
    return this.#desktopSourceIds.get(displayId);
  }

  #nativeCapture(): WindowsScreenCapture {
    if (this.#disposed)
      throw new ScreenshotError('CAPTURE_FAILED', 'Capture adapter is disposed.');
    return (this.#windowsCapture ??= new NativeWindowsScreenCapture());
  }

  /** 屏幕配置变化才失效并预热，普通截图保留原有的 ID 缓存命中路径。 */
  readonly #invalidateDesktopSources: DisplayChangeListener = (
    _event,
    _display,
    changedMetrics
  ): void => {
    // 仅工作区变化不影响整屏来源，不重启枚举或清除已有降级状态。
    if (
      changedMetrics?.length &&
      changedMetrics.every((metric) => metric === 'workArea')
    )
      return;
    this.#sourceRevision++;
    this.#desktopSourceIds.clear();
    this.#desktopSourceFallbacks.clear();
    void this.prepare().catch(() => undefined);
  };

  #watchDesktopSources(): void {
    if (!this.#watchingSources && this.#screen.on && this.#screen.removeListener) {
      for (const event of DISPLAY_CHANGE_EVENTS) {
        this.#screen.on(event, this.#invalidateDesktopSources);
      }
      powerMonitor.on('resume', this.#invalidateDesktopSources);
      powerMonitor.on('unlock-screen', this.#invalidateDesktopSources);
      this.#watchingSources = true;
    }
  }

  #enumerateDesktopSources(): Promise<void> {
    this.#desktopSourceEnumeration ??= app
      .whenReady()
      .then(async () => {
        if (this.#disposed)
          throw new Error('The screen capture adapter has been disposed.');
        this.#watchDesktopSources();
        while (!this.#disposed) {
          const revision = this.#sourceRevision;
          const sources = await this.#desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 0, height: 0 },
            fetchWindowIcons: false,
          });
          // 先等旧请求结束再重取，避免 Electron 合并并发枚举并返回旧拓扑结果。
          if (revision !== this.#sourceRevision) continue;
          this.#desktopSourceIds.clear();
          for (const display of this.#screen.getAllDisplays()) {
            const displayId = String(display.id);
            const source = this.#findDisplaySource(sources, displayId);
            if (source?.id) this.#desktopSourceIds.set(displayId, source.id);
          }
          return;
        }
        throw new Error('The screen capture adapter has been disposed.');
      })
      .finally(() => {
        this.#desktopSourceEnumeration = undefined;
      });
    return this.#desktopSourceEnumeration;
  }

  /** 两条采集路径按同一身份匹配；source.id 不是 Display.id，禁止按下标猜多屏。 */
  #findDisplaySource(
    sources: DesktopCaptureSource[],
    displayId: string
  ): DesktopCaptureSource | undefined {
    const matches = sources.filter((source) => source.display_id === displayId);
    if (matches.length === 1) return matches[0];
    const displays = this.#screen.getAllDisplays();
    if (
      sources.length === 1 &&
      !sources[0]?.display_id &&
      displays.length === 1 &&
      String(displays[0]?.id) === displayId
    ) {
      return sources[0];
    }
    return undefined;
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
