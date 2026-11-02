export type ScreenshotTool =
  'rectangle' | 'ellipse' | 'arrow' | 'brush' | 'text' | 'mosaic' | 'watermark';

export interface ScreenshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen DIP candidate; lower z-order wins before comparing container sizes. */
export interface ScreenshotSnapRegion extends ScreenshotBounds {
  /** Optional target display for native candidates split across mixed-DPI monitors. */
  displayId?: string;
  windowZOrder?: number;
  kind?: 'window' | 'container';
  /** Native provenance for diagnostics; no application content is included. */
  sourceProcessId?: number;
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
  /** Initial preparation mode. record() sets this to record automatically. */
  mode?: 'screenshot' | 'record';
  recording?: RecordingOptions;
  display?: 'cursor' | 'primary' | string;
  /** Windows/macOS live selection captures only after selection; frozen preserves the original flow. */
  interactionMode?: 'frozen' | 'live';
  tools?: ScreenshotTool[];
  defaultTool?: 'select' | ScreenshotTool;
  /** 复制成功后是否显示提示，默认关闭；传 true 开启。 */
  showCopyFeedback?: boolean;
  locale?: ScreenshotLocale;
  messages?: ScreenshotMessageOverrides;
  theme?: ScreenshotTheme;
}

/** Native handles of our own interaction overlays; never exclude the entire host process. */
export interface ScreenshotSnapContext {
  excludedWindowHandles: string[];
  /** macOS CGWindowIDs; NSView pointers from getNativeWindowHandle are not window IDs. */
  excludedWindowIds?: string[];
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
  | RecordingFileResult
  | {
      status: 'cancelled';
    }
  | {
      status: 'failed';
      code: ScreenshotErrorCode;
      message: string;
      /** Owned partial recording retained after an encoder/write failure. */
      recoveryPath?: string;
    };

export interface ScreenshotRendererApi {
  capture(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  record(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  cancel(): Promise<boolean>;
}

/** Recording preferences; GIF is always silent and capped at 60 seconds. */
export interface RecordingOptions {
  format?: 'mp4' | 'gif';
  maxMp4DurationSeconds?: number;
  audio?: 'none' | 'microphone' | 'system' | 'both';
  /** Device IDs come from this recording session's media-device picker. */
  microphoneDeviceId?: string;
  camera?: boolean;
  cameraDeviceId?: string;
}

/** Large recordings are returned as files, never as an IPC-sized byte array. */
export interface RecordingFileResult {
  status: 'recorded';
  filePath: string;
  format: 'mp4' | 'gif';
  mimeType: 'video/mp4' | 'image/gif';
  durationSeconds: number;
  bytes: number;
  displayId: string;
  bounds: ScreenshotBounds;
}
