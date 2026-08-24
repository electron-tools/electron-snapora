import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCREENSHOT_RESOURCE_LIMITS,
  findCapturedFrameLimitViolation,
  resolveScreenshotResourceLimits,
} from './limits.js';

describe('screenshot resource limits', () => {
  it('uses safe defaults and accepts lower application limits', () => {
    expect(resolveScreenshotResourceLimits()).toEqual(
      DEFAULT_SCREENSHOT_RESOURCE_LIMITS
    );
    expect(resolveScreenshotResourceLimits({ maxOutputBytes: 1024 })).toMatchObject({
      maxOutputBytes: 1024,
    });
  });

  it('rejects invalid or excessive public configuration', () => {
    expect(() => resolveScreenshotResourceLimits({ maxCapturePixels: 0 })).toThrow(
      /maxCapturePixels/
    );
    expect(() =>
      resolveScreenshotResourceLimits({ maxOutputBytes: Number.MAX_SAFE_INTEGER })
    ).toThrow(/maxOutputBytes/);
  });

  it('detects pixel and Data URL overflows', () => {
    const limits = resolveScreenshotResourceLimits({
      maxCapturePixels: 4,
      maxCaptureDataUrlBytes: 8,
    });
    const frame = {
      display: {
        id: '1',
        bounds: { x: 0, y: 0, width: 3, height: 2 },
        scaleFactor: 1,
      },
      dataUrl: '123456789',
      pixelSize: { width: 3, height: 2 },
    };

    expect(findCapturedFrameLimitViolation(frame, limits)).toMatch(/pixel limit/);
    expect(
      findCapturedFrameLimitViolation(
        { ...frame, pixelSize: { width: 2, height: 2 } },
        limits
      )
    ).toMatch(/Data URL limit/);
    expect(
      findCapturedFrameLimitViolation(
        {
          kind: 'desktop-source',
          display: frame.display,
          sourceId: 'screen:1:0',
          pixelSize: { width: 2, height: 2 },
        },
        limits
      )
    ).toBeUndefined();
  });
});
