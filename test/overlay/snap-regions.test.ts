import { describe, expect, it } from 'vitest';
import { resolveSnapRegions } from '../../src/overlay/snap-regions.js';

describe('container snap candidates', () => {
  it('keeps a background container behind the foreground window, even when smaller', () => {
    const result = resolveSnapRegions(
      [
        { x: 0, y: 0, width: 800, height: 600, windowZOrder: 0, kind: 'window' },
        { x: 10, y: 10, width: 80, height: 60, windowZOrder: 1, kind: 'container' },
        { x: 20, y: 20, width: 300, height: 200, windowZOrder: 0, kind: 'container' },
      ],
      { x: 0, y: 0, width: 1920, height: 1080 }
    );
    expect(result.map((r) => [r.windowZOrder, r.kind])).toEqual([
      [0, 'container'],
      [0, 'window'],
      [1, 'container'],
    ]);
  });

  it('clips negative screen coordinates and rejects invisible/invalid candidates', () => {
    expect(
      resolveSnapRegions(
        [
          { x: -2100, y: -100, width: 400, height: 300 },
          { x: 5, y: 5, width: 100, height: 100 },
          { x: NaN, y: 0, width: 100, height: 100 },
        ],
        { x: -1920, y: 0, width: 1920, height: 1080 }
      )
    ).toEqual([{ x: 0, y: 0, width: 220, height: 200 }]);
  });
});
