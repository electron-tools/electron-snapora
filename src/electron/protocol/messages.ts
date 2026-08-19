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
  capture(options: ScreenshotOptions): Promise<CapturedFrame[]>;
}

export interface ScreenshotInitializePayload {
  protocolVersion: typeof SCREENSHOT_PROTOCOL_VERSION;
  jobId: string;
  options: ScreenshotOptions;
  frames: CapturedFrame[];
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

export type ScreenshotOutputAction = 'save' | 'copy';

export interface ScreenshotOutputPayload {
  protocolVersion: typeof SCREENSHOT_PROTOCOL_VERSION;
  jobId: string;
  action: ScreenshotOutputAction;
  result: ScreenshotImageResult;
}

export type ScreenshotOutputResponse =
  | { status: 'completed'; action: 'copy' }
  | { status: 'completed'; action: 'save'; filePath: string }
  | { status: 'cancelled' }
  | { status: 'failed'; code: ScreenshotErrorCode; message: string };
