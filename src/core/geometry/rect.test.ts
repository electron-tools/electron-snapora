import { describe, expect, it } from 'vitest';
import { clampRect, normalizeRect, viewportPointToImagePoint } from './rect.js';

describe('rectangle geometry', () => {
  it('normalizes a drag in any direction', () => {
    expect(normalizeRect({ x: 20, y: 30 }, { x: 5, y: 10 })).toEqual({
      x: 5,
      y: 10,
      width: 15,
      height: 20,
    });
  });

  it('clamps a rectangle to image bounds', () => {
    expect(
      clampRect(
        { x: -10, y: 30, width: 50, height: 100 },
        { x: 0, y: 0, width: 80, height: 80 }
      )
    ).toEqual({ x: 0, y: 30, width: 40, height: 50 });
  });

  it('maps viewport coordinates to actual image pixels', () => {
    expect(
      viewportPointToImagePoint(
        { x: 100, y: 50 },
        { width: 200, height: 100 },
        { width: 400, height: 300 }
      )
    ).toEqual({ x: 200, y: 150 });
  });
});
