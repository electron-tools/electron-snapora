import type { ScreenshotErrorCode, ScreenshotResult } from '../../types.js';

export class ScreenshotError extends Error {
  readonly code: ScreenshotErrorCode;

  constructor(code: ScreenshotErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScreenshotError';
    this.code = code;
  }
}

export function toScreenshotFailure(
  error: unknown,
  fallbackCode: ScreenshotErrorCode = 'CAPTURE_FAILED'
): ScreenshotResult {
  if (error instanceof ScreenshotError) {
    return {
      status: 'failed',
      code: error.code,
      message: error.message,
    };
  }

  return {
    status: 'failed',
    code: fallbackCode,
    message: error instanceof Error ? error.message : 'Unknown screenshot error.',
  };
}
