import type { ScreenshotBounds, ScreenshotSnapRegion } from '../types.js';

/** Clip screen DIP candidates to this display; foreground windows always win. */
export function resolveSnapRegions(
  regions: ScreenshotSnapRegion[],
  display: ScreenshotBounds
): ScreenshotSnapRegion[] {
  return regions
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
