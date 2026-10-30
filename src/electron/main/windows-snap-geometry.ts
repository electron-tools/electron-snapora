import type { ScreenshotBounds } from '../../types.js';
import type { WindowsSnapCandidate } from './windows-snap-policy.js';

/** Monitor geometry captured once per query; physical coordinates must share UIA's pixel space. */
export interface WindowsSnapDisplay {
  id: string;
  bounds: ScreenshotBounds;
  physicalBounds: ScreenshotBounds;
  scaleFactor: number;
}

/** Clip in physical pixels first, then convert each piece using its own monitor's origin/scale.
 * A whole cross-monitor rectangle cannot be represented by a single global DIP rectangle.
 */
export function splitWindowsSnapCandidate(
  candidate: WindowsSnapCandidate,
  displays: WindowsSnapDisplay[]
): WindowsSnapCandidate[] {
  const pieces: WindowsSnapCandidate[] = [];
  for (const display of displays) {
    const p = display.physicalBounds;
    const left = Math.max(candidate.x, p.x);
    const top = Math.max(candidate.y, p.y);
    const right = Math.min(candidate.x + candidate.width, p.x + p.width);
    const bottom = Math.min(candidate.y + candidate.height, p.y + p.height);
    if (right <= left || bottom <= top) continue;
    const d = display.bounds;
    const x = d.x + Math.floor((left - p.x) / display.scaleFactor);
    const y = d.y + Math.floor((top - p.y) / display.scaleFactor);
    // Electron rounds monitor DIP dimensions; clamp the enclosing rectangle at the DIP edge.
    const endX = Math.min(
      d.x + d.width,
      d.x + Math.ceil((right - p.x) / display.scaleFactor)
    );
    const endY = Math.min(
      d.y + d.height,
      d.y + Math.ceil((bottom - p.y) / display.scaleFactor)
    );
    if (endX > x && endY > y)
      pieces.push({
        ...candidate,
        displayId: display.id,
        x,
        y,
        width: endX - x,
        height: endY - y,
      });
  }
  return pieces;
}
