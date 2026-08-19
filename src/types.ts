export type ScreenshotTool =
  'rectangle' | 'ellipse' | 'arrow' | 'brush' | 'text' | 'mosaic';

export interface ScreenshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotTheme {
  accentColor?: string;
  maskColor?: string;
  toolbarBackground?: string;
}

export interface ScreenshotOptions {
  display?: 'cursor' | 'primary' | string;
  tools?: ScreenshotTool[];
  defaultTool?: 'select' | ScreenshotTool;
  locale?: 'zh-CN' | 'en-US';
  theme?: ScreenshotTheme;
}

export type ScreenshotErrorCode =
  | 'CAPTURE_BUSY'
  | 'INVALID_REQUEST'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'PERMISSION_DENIED'
  | 'DISPLAY_NOT_FOUND'
  | 'CAPTURE_FAILED'
  | 'OVERLAY_LOAD_FAILED'
  | 'EXPORT_FAILED'
  | 'INVALID_RESULT'
  | 'UNSUPPORTED_PLATFORM';

export interface ScreenshotImageResult {
  status: 'completed';
  data: Uint8Array;
  mimeType: 'image/png';
  bounds: ScreenshotBounds;
  displayId: string;
}

export type ScreenshotOutputMetadata =
  { action: 'copy' } | { action: 'save'; filePath: string };

export type ScreenshotResult =
  | (ScreenshotImageResult & { output: ScreenshotOutputMetadata })
  | {
      status: 'cancelled';
    }
  | {
      status: 'failed';
      code: ScreenshotErrorCode;
      message: string;
    };

export interface ScreenshotRendererApi {
  capture(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  cancel(): Promise<boolean>;
}
