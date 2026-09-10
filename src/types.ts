export type ScreenshotTool =
  'rectangle' | 'ellipse' | 'arrow' | 'brush' | 'text' | 'mosaic' | 'watermark';

export interface ScreenshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ScreenshotLocale = 'en-US' | 'zh-CN' | 'ja-JP' | 'ko-KR' | 'es-ES';

export interface ScreenshotMessages {
  preparing: string;
  instruction: string;
  exporting: string;
  copied: string;
  saveCancelled: string;
  copy: string;
  cancel: string;
  save: string;
  close: string;
  pin: string;
  confirm: string;
  select: string;
  rectangle: string;
  ellipse: string;
  arrow: string;
  brush: string;
  text: string;
  textDefault: string;
  textFill: string;
  textOutline: string;
  mosaic: string;
  watermark: string;
  undo: string;
  redo: string;
  color: string;
  customColor: string;
  lineWidth: string;
  fontSize: string;
  mosaicStrength: string;
  opacity: string;
  watermarkPlaceholder: string;
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
  warningColor?: string;
  warningForegroundColor?: string;
  selectionHandleColor?: string;
  /** 复制成功提示的背景、文字、边框及图标颜色。 */
  copyFeedbackBackground?: string;
  copyFeedbackForeground?: string;
  copyFeedbackBorderColor?: string;
  copyFeedbackIconColor?: string;
  copyFeedbackIconBackground?: string;
}

export interface ScreenshotOptions {
  display?: 'cursor' | 'primary' | string;
  tools?: ScreenshotTool[];
  defaultTool?: 'select' | ScreenshotTool;
  /** 复制成功后是否显示提示，默认关闭；传 true 开启。 */
  showCopyFeedback?: boolean;
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
  { action: 'copy' } | { action: 'save'; filePath: string } | { action: 'pin' };

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
