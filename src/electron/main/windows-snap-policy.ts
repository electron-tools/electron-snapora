import type { ScreenshotSnapRegion } from '../../types.js';

/** Window outline, major layout panels, or the original fine-grained UIA containers. */
export type WindowsSnapGranularity = 'window' | 'panel' | 'fine';

/** Internal worker metadata; controlType is a UIA enum name, never user content. */
export interface WindowsSnapCandidate extends ScreenshotSnapRegion {
  controlType?: string;
}

const PANEL_TYPES = new Set([
  'Pane',
  'Group',
  'Document',
  'List',
  'Tree',
  'DataGrid',
  'Table',
  'Tab',
]);
const area = (r: ScreenshotSnapRegion): number => r.width * r.height;
const contains = (outer: ScreenshotSnapRegion, inner: ScreenshotSnapRegion): boolean =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

/** Apply policy in DIP after native enumeration, retaining every window for occlusion. */
export function filterWindowsSnapRegions(
  candidates: WindowsSnapCandidate[],
  granularity: WindowsSnapGranularity
): ScreenshotSnapRegion[] {
  const windows = candidates.filter((r) => r.kind === 'window');
  if (granularity === 'window') return windows;
  if (granularity === 'fine') return candidates;
  const panels: WindowsSnapCandidate[] = [];
  for (const window of windows) {
    const eligible = candidates
      .filter(
        (r) =>
          r.kind === 'container' &&
          r.displayId === window.displayId &&
          r.windowZOrder === window.windowZOrder &&
          r.sourceProcessId === window.sourceProcessId &&
          PANEL_TYPES.has(r.controlType ?? '') &&
          contains(window, r) &&
          r.width >= 160 &&
          r.height >= 120 &&
          area(r) >= area(window) * 0.08 &&
          (r.width >= window.width * 0.3 || r.height >= window.height * 0.5)
      )
      .sort((a, b) => area(b) - area(a));
    const retained: WindowsSnapCandidate[] = [];
    for (const region of eligible) {
      // Collapse near-identical wrappers, then keep only the outermost meaningful layout panels.
      // Message cards / nested groups belong to fine mode, even when they occupy a large area.
      const ancestors = [window, ...retained].filter((parent) =>
        contains(parent, region)
      );
      if (ancestors.some((parent) => area(region) >= area(parent) * 0.9)) continue;
      if (ancestors.length > 1) continue;
      retained.push(region);
    }
    panels.push(...retained);
  }
  return [...windows, ...panels];
}
