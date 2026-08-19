import type {
  ScreenshotBounds,
  ScreenshotErrorCode,
  ScreenshotImageResult,
  ScreenshotOptions,
  ScreenshotOutputMetadata,
  ScreenshotResult,
  ScreenshotTheme,
  ScreenshotTool,
} from '../../types.js';
import {
  SCREENSHOT_PROTOCOL_VERSION,
  type ScreenshotCancelPayload,
  type ScreenshotCompletePayload,
  type ScreenshotErrorPayload,
  type ScreenshotOutputPayload,
  type ScreenshotPreparedPayload,
  type ScreenshotReadyPayload,
} from './messages.js';
import { HARD_SCREENSHOT_RESOURCE_LIMITS } from './limits.js';

const SCREENSHOT_ERROR_CODES = new Set<ScreenshotErrorCode>([
  'CAPTURE_BUSY',
  'INVALID_REQUEST',
  'RESOURCE_LIMIT_EXCEEDED',
  'PERMISSION_DENIED',
  'DISPLAY_NOT_FOUND',
  'CAPTURE_FAILED',
  'OVERLAY_LOAD_FAILED',
  'EXPORT_FAILED',
  'INVALID_RESULT',
  'UNSUPPORTED_PLATFORM',
]);

const SCREENSHOT_TOOLS = new Set<ScreenshotTool>([
  'rectangle',
  'ellipse',
  'arrow',
  'brush',
  'text',
  'mosaic',
]);

const SCREENSHOT_OPTION_KEYS = new Set([
  'display',
  'tools',
  'defaultTool',
  'locale',
  'theme',
]);

const SCREENSHOT_THEME_KEYS = new Set([
  'accentColor',
  'maskColor',
  'toolbarBackground',
]);

export type ScreenshotOptionsParseResult =
  { success: true; value: ScreenshotOptions } | { success: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>
): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

/**
 * Renderer 传入的类型声明不能替代 IPC 边界校验。这里复制白名单字段，
 * 避免畸形枚举、超长字符串或未来未审计字段进入捕获与 Overlay 流程。
 */
export function parseScreenshotOptions(value: unknown): ScreenshotOptionsParseResult {
  if (value === undefined) {
    return { success: true, value: {} };
  }
  if (!isRecord(value) || !hasOnlyKeys(value, SCREENSHOT_OPTION_KEYS)) {
    return {
      success: false,
      message: 'Screenshot options must be a plain supported object.',
    };
  }

  const parsed: ScreenshotOptions = {};
  if (value.display !== undefined) {
    if (!isBoundedString(value.display, 128)) {
      return {
        success: false,
        message: 'Screenshot display must be a non-empty string.',
      };
    }
    parsed.display = value.display;
  }

  if (value.tools !== undefined) {
    if (
      !Array.isArray(value.tools) ||
      value.tools.length > SCREENSHOT_TOOLS.size ||
      !value.tools.every(
        (tool): tool is ScreenshotTool =>
          typeof tool === 'string' && SCREENSHOT_TOOLS.has(tool as ScreenshotTool)
      )
    ) {
      return {
        success: false,
        message: 'Screenshot tools contain an unsupported value.',
      };
    }
    parsed.tools = [...new Set(value.tools)];
  }

  if (value.defaultTool !== undefined) {
    if (
      value.defaultTool !== 'select' &&
      (typeof value.defaultTool !== 'string' ||
        !SCREENSHOT_TOOLS.has(value.defaultTool as ScreenshotTool))
    ) {
      return { success: false, message: 'Screenshot defaultTool is unsupported.' };
    }
    if (
      value.defaultTool !== 'select' &&
      parsed.tools &&
      !parsed.tools.includes(value.defaultTool as ScreenshotTool)
    ) {
      return {
        success: false,
        message: 'Screenshot defaultTool must be enabled in tools.',
      };
    }
    parsed.defaultTool = value.defaultTool as 'select' | ScreenshotTool;
  }

  if (value.locale !== undefined) {
    if (value.locale !== 'zh-CN' && value.locale !== 'en-US') {
      return { success: false, message: 'Screenshot locale is unsupported.' };
    }
    parsed.locale = value.locale;
  }

  if (value.theme !== undefined) {
    const theme = parseScreenshotTheme(value.theme);
    if (!theme) {
      return { success: false, message: 'Screenshot theme is invalid.' };
    }
    parsed.theme = theme;
  }

  return { success: true, value: parsed };
}

function parseScreenshotTheme(value: unknown): ScreenshotTheme | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, SCREENSHOT_THEME_KEYS)) {
    return undefined;
  }

  const theme: ScreenshotTheme = {};
  for (const key of SCREENSHOT_THEME_KEYS) {
    const color = value[key];
    if (color === undefined) {
      continue;
    }
    if (!isBoundedString(color, 128)) {
      return undefined;
    }
    theme[key as keyof ScreenshotTheme] = color;
  }
  return theme;
}

function hasProtocolVersion(value: Record<string, unknown>): boolean {
  return value.protocolVersion === SCREENSHOT_PROTOCOL_VERSION;
}

function hasExpectedJob(
  value: Record<string, unknown>,
  expectedJobId: string
): boolean {
  return value.jobId === expectedJobId;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBounds(value: unknown): value is ScreenshotBounds {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function isImageResult(
  value: unknown,
  maxOutputBytes = HARD_SCREENSHOT_RESOURCE_LIMITS.maxOutputBytes
): value is ScreenshotImageResult {
  if (!isRecord(value) || value.status !== 'completed') {
    return false;
  }

  return (
    value.data instanceof Uint8Array &&
    value.data.byteLength > 0 &&
    value.data.byteLength <= maxOutputBytes &&
    value.mimeType === 'image/png' &&
    isBounds(value.bounds) &&
    typeof value.displayId === 'string' &&
    value.displayId.length > 0
  );
}

function isOutputMetadata(value: unknown): value is ScreenshotOutputMetadata {
  if (!isRecord(value)) {
    return false;
  }
  if (value.action === 'copy') {
    return true;
  }
  return (
    value.action === 'save' &&
    typeof value.filePath === 'string' &&
    value.filePath.length > 0
  );
}

function isCompletedResult(
  value: unknown,
  maxOutputBytes?: number
): value is Extract<ScreenshotResult, { status: 'completed' }> {
  return (
    isImageResult(value, maxOutputBytes) &&
    isOutputMetadata((value as unknown as Record<string, unknown>).output)
  );
}

export function isReadyPayload(value: unknown): value is ScreenshotReadyPayload {
  return isRecord(value) && hasProtocolVersion(value);
}

export function isPreparedPayload(
  value: unknown,
  expectedJobId: string
): value is ScreenshotPreparedPayload {
  return (
    isRecord(value) && hasProtocolVersion(value) && hasExpectedJob(value, expectedJobId)
  );
}

export function isCompletePayload(
  value: unknown,
  expectedJobId: string,
  maxOutputBytes?: number
): value is ScreenshotCompletePayload {
  return (
    isRecord(value) &&
    hasProtocolVersion(value) &&
    hasExpectedJob(value, expectedJobId) &&
    isCompletedResult(value.result, maxOutputBytes)
  );
}

export function isCancelPayload(
  value: unknown,
  expectedJobId: string
): value is ScreenshotCancelPayload {
  return (
    isRecord(value) && hasProtocolVersion(value) && hasExpectedJob(value, expectedJobId)
  );
}

export function isErrorPayload(
  value: unknown,
  expectedJobId: string
): value is ScreenshotErrorPayload {
  return (
    isRecord(value) &&
    hasProtocolVersion(value) &&
    hasExpectedJob(value, expectedJobId) &&
    typeof value.code === 'string' &&
    SCREENSHOT_ERROR_CODES.has(value.code as ScreenshotErrorCode) &&
    typeof value.message === 'string' &&
    value.message.length > 0
  );
}

export function isOutputPayload(
  value: unknown,
  maxOutputBytes?: number
): value is ScreenshotOutputPayload {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasProtocolVersion(value) &&
    typeof value.jobId === 'string' &&
    value.jobId.length > 0 &&
    (value.action === 'save' || value.action === 'copy') &&
    isImageResult(value.result, maxOutputBytes)
  );
}
