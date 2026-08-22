import type {
  ScreenshotBounds,
  ScreenshotErrorCode,
  ScreenshotImageResult,
  ScreenshotOptions,
  ScreenshotResult,
} from '../../types.js';

export const SCREENSHOT_PROTOCOL_VERSION = 1 as const;

export interface ScreenshotReadyPayload {
  protocolVersion: typeof SCREENSHOT_PROTOCOL_VERSION;
}

export interface ScreenshotPreparedPayload extends ScreenshotReadyPayload {
  jobId: string;
}

export interface CaptureDisplay {
  id: string;
  bounds: ScreenshotBounds;
  scaleFactor: number;
}

export interface CapturedFrame {
  display: CaptureDisplay;
  dataUrl: string;
  pixelSize: {
    width: number;
    height: number;
  };
}

export interface ScreenCaptureAdapter {
  /**
   * 可选的同步目标解析，用于让主进程在屏幕采集期间并行加载隐藏 Overlay。
   * 返回值会作为锁定目标传给紧随其后的 capture()，避免鼠标跨屏造成截图与窗口错位。
   */
  resolveTargetDisplay?(options: ScreenshotOptions): CaptureDisplay;
  capture(
    options: ScreenshotOptions,
    targetDisplay?: CaptureDisplay
  ): Promise<CapturedFrame[]>;
}

export interface ScreenshotInitializePayload {
  protocolVersion: typeof SCREENSHOT_PROTOCOL_VERSION;
  jobId: string;
  options: ScreenshotOptions;
  frames: CapturedFrame[];
  /** 可单击吸附的可见窗口区域，使用全局 Screen DIP 坐标。 */
  windowSnapRegions?: ScreenshotBounds[];
}

export interface ScreenshotFeedbackPayload {
  kind: 'copy';
  durationMs: number;
  options: ScreenshotOptions;
}

export interface ScreenshotCompletePayload {
  protocolVersion: typeof SCREENSHOT_PROTOCOL_VERSION;
  jobId: string;
  result: ScreenshotResult;
}

export interface ScreenshotCancelPayload {
  protocolVersion: typeof SCREENSHOT_PROTOCOL_VERSION;
  jobId: string;
}

export interface ScreenshotErrorPayload {
  protocolVersion: typeof SCREENSHOT_PROTOCOL_VERSION;
  jobId: string;
  code: ScreenshotErrorCode;
  message: string;
}

export type ScreenshotOutputAction = 'save' | 'copy' | 'pin';

export interface ScreenshotOutputPayload {
  protocolVersion: typeof SCREENSHOT_PROTOCOL_VERSION;
  jobId: string;
  action: ScreenshotOutputAction;
  result: ScreenshotImageResult;
}

export type ScreenshotOutputResponse =
  | { status: 'completed'; action: 'copy' }
  | { status: 'completed'; action: 'save'; filePath: string }
  | { status: 'completed'; action: 'pin' }
  | { status: 'cancelled' }
  | { status: 'failed'; code: ScreenshotErrorCode; message: string };
