import type { CapturedFrame } from './messages.js';

export interface ScreenshotResourceLimits {
  maxCapturePixels: number;
  maxCaptureDataUrlBytes: number;
  maxOutputBytes: number;
}

export type ScreenshotResourceLimitOptions = Partial<ScreenshotResourceLimits>;

export const DEFAULT_SCREENSHOT_RESOURCE_LIMITS: Readonly<ScreenshotResourceLimits> =
  Object.freeze({
    maxCapturePixels: 64 * 1024 * 1024,
    maxCaptureDataUrlBytes: 192 * 1024 * 1024,
    maxOutputBytes: 64 * 1024 * 1024,
  });

export const HARD_SCREENSHOT_RESOURCE_LIMITS: Readonly<ScreenshotResourceLimits> =
  Object.freeze({
    maxCapturePixels: 128 * 1024 * 1024,
    maxCaptureDataUrlBytes: 256 * 1024 * 1024,
    maxOutputBytes: 256 * 1024 * 1024,
  });

export function resolveScreenshotResourceLimits(
  options: ScreenshotResourceLimitOptions = {}
): ScreenshotResourceLimits {
  return {
    maxCapturePixels: resolveLimit('maxCapturePixels', options.maxCapturePixels),
    maxCaptureDataUrlBytes: resolveLimit(
      'maxCaptureDataUrlBytes',
      options.maxCaptureDataUrlBytes
    ),
    maxOutputBytes: resolveLimit('maxOutputBytes', options.maxOutputBytes),
  };
}

/** 返回第一项超限原因，由调用层决定映射为捕获失败或导出失败。 */
export function findCapturedFrameLimitViolation(
  frame: CapturedFrame,
  limits: ScreenshotResourceLimits
): string | undefined {
  const { width, height } = frame.pixelSize;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > limits.maxCapturePixels
  ) {
    return `Captured frame exceeds the ${limits.maxCapturePixels} pixel limit.`;
  }
  if (frame.dataUrl.length > limits.maxCaptureDataUrlBytes) {
    return `Captured frame exceeds the ${limits.maxCaptureDataUrlBytes} byte Data URL limit.`;
  }
  return undefined;
}

function resolveLimit(
  key: keyof ScreenshotResourceLimits,
  configuredValue: number | undefined
): number {
  const value = configuredValue ?? DEFAULT_SCREENSHOT_RESOURCE_LIMITS[key];
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > HARD_SCREENSHOT_RESOURCE_LIMITS[key]
  ) {
    throw new TypeError(
      `[electron-snapora] ${key} must be a positive safe integer no greater than ${HARD_SCREENSHOT_RESOURCE_LIMITS[key]}.`
    );
  }
  return value;
}
