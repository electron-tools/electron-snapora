import type { ScreenshotBounds, ScreenshotSnapRegion } from '../types.js';
import type { Point } from '../core/geometry/rect.js';

/** Sorted containers win, then their window; live desktop gaps fall back to this screen only. */
export function findSnapRegion(
  regions: ScreenshotBounds[],
  point: Point,
  screenFallback?: ScreenshotBounds
): ScreenshotBounds | null {
  const contains = (r: ScreenshotBounds) =>
    point.x >= r.x &&
    point.y >= r.y &&
    point.x < r.x + r.width &&
    point.y < r.y + r.height;
  return (
    regions.find(contains) ??
    (screenFallback && contains(screenFallback) ? screenFallback : null)
  );
}

/** Clip screen DIP candidates to this display; foreground windows always win. */
export function resolveSnapRegions(
  regions: ScreenshotSnapRegion[],
  display: ScreenshotBounds,
  displayId?: string
): ScreenshotSnapRegion[] {
  return regions
    .filter(
      (region) =>
        displayId === undefined ||
        region.displayId === undefined ||
        region.displayId === displayId
    )
    .filter((region) =>
      [region.x, region.y, region.width, region.height].every(Number.isFinite)
    )
    .map((region) => {
      const left = Math.max(region.x, display.x);
      const top = Math.max(region.y, display.y);
      const right = Math.min(region.x + region.width, display.x + display.width);
      const bottom = Math.min(region.y + region.height, display.y + display.height);
      return {
        ...region,
        x: left - display.x,
        y: top - display.y,
        width: right - left,
        height: bottom - top,
      };
    })
    .filter((region) => region.width >= 4 && region.height >= 4)
    .sort(
      (a, b) =>
        (a.windowZOrder ?? 0) - (b.windowZOrder ?? 0) ||
        a.width * a.height - b.width * b.height
    );
}
