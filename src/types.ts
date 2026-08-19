export type ScreenshotTool =
  'rectangle' | 'ellipse' | 'arrow' | 'brush' | 'text' | 'mosaic';

export interface ScreenshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ScreenshotLocale = 'zh-CN' | 'en-US';

export interface ScreenshotMessages {
  preparing: string;
  instruction: string;
  exporting: string;
  saveCancelled: string;
  cancel: string;
  save: string;
  confirm: string;
  select: string;
  rectangle: string;
  ellipse: string;
  arrow: string;
  brush: string;
  text: string;
  mosaic: string;
  undo: string;
  redo: string;
  color: string;
  lineWidth: string;
  fontSize: string;
  annotationCanvas: string;
  selection: string;
  actions: string;
  annotationTools: string;
  history: string;
  annotationStyle: string;
  outputActions: string;
  annotationText: string;
}

export type ScreenshotMessageOverrides = Partial<ScreenshotMessages>;

export interface ScreenshotTheme {
  mode?: 'dark' | 'light';
  accentColor?: string;
  accentForegroundColor?: string;
  maskColor?: string;
  toolbarBackground?: string;
  toolbarForeground?: string;
  toolbarBorderColor?: string;
  toolbarHoverBackground?: string;
  tooltipBackground?: string;
  tooltipForeground?: string;
  destructiveColor?: string;
  selectionHandleColor?: string;
}

export interface ScreenshotOptions {
  display?: 'cursor' | 'primary' | string;
  tools?: ScreenshotTool[];
  defaultTool?: 'select' | ScreenshotTool;
  locale?: ScreenshotLocale;
  messages?: ScreenshotMessageOverrides;
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
