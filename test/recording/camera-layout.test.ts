import { describe, expect, it } from 'vitest';
import { cameraBounds, parseCameraStyle } from '../../src/recording/camera-layout.js';

describe('camera presentation bounds', () => {
  it('retains all three distinct sizes, aspect ratios and the nearest corner on a negative-origin display', () => {
    const area = { x: -1600, y: -200, width: 1200, height: 900 };
    for (const shape of ['rectangle', 'square', 'circle'] as const) {
      let previous;
      for (const [size, width] of [
        ['small', 128],
        ['medium', 160],
        ['large', 224],
      ] as const) {
        const bounds = cameraBounds(area, { shape, size }, previous);
        expect(bounds.width).toBe(width);
        expect(bounds.height).toBe(
          shape === 'rectangle' ? Math.floor((width * 9) / 16) : width
        );
        expect(bounds.x + bounds.width).toBe(area.x + area.width);
        expect(bounds.y + bounds.height).toBe(area.y + area.height);
        previous = bounds;
      }
    }
  });
  it('shrinks the presets together to stay inside narrow selections without losing the size hierarchy', () => {
    const area = { x: 30, y: 50, width: 150, height: 110 };
    for (const shape of ['rectangle', 'square', 'circle'] as const) {
      let previousWidth = 0;
      for (const size of ['small', 'medium', 'large'] as const) {
        const b = cameraBounds(area, { shape, size });
        expect(b.width).toBeGreaterThan(previousWidth);
        expect(b.x).toBeGreaterThanOrEqual(area.x);
        expect(b.y).toBeGreaterThanOrEqual(area.y);
        expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width);
        expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height);
        previousWidth = b.width;
      }
    }
  });
  it('rejects arbitrary size and shape values at IPC boundaries', () => {
    for (const v of [
      null,
      {},
      { shape: 'circle', size: 10000 },
      { shape: '<svg>', size: 'large' },
    ])
      expect(() => parseCameraStyle(v)).toThrow('Invalid camera style');
  });
});
