import { describe, expect, it } from 'vitest';
import {
  splitWindowsSnapCandidate,
  type WindowsSnapDisplay,
} from '../../../src/electron/main/windows-snap-geometry.js';
import { filterWindowsSnapRegions } from '../../../src/electron/main/windows-snap-policy.js';
import { resolveSnapRegions } from '../../../src/overlay/snap-regions.js';

// The actual 150%/100% topology that exposed the cross-monitor conversion error.
const displays: WindowsSnapDisplay[] = [
  {
    id: 'primary',
    bounds: { x: 0, y: 0, width: 2134, height: 1334 },
    physicalBounds: { x: 0, y: 0, width: 3200, height: 2000 },
    scaleFactor: 1.5,
  },
  {
    id: 'right',
    bounds: { x: 2134, y: 274, width: 2560, height: 1440 },
    physicalBounds: { x: 3200, y: 412, width: 2560, height: 1440 },
    scaleFactor: 1,
  },
];

describe('mixed-DPI native snap geometry', () => {
  it('splits a cross-screen window before scaling and clips previews to their own display', () => {
    const pieces = splitWindowsSnapCandidate(
      { x: 3101, y: 512, width: 400, height: 300, kind: 'window', windowZOrder: 0 },
      displays
    );
    expect(pieces).toEqual([
      {
        x: 2067,
        y: 341,
        width: 67,
        height: 201,
        kind: 'window',
        windowZOrder: 0,
        displayId: 'primary',
      },
      {
        x: 2134,
        y: 374,
        width: 301,
        height: 300,
        kind: 'window',
        windowZOrder: 0,
        displayId: 'right',
      },
    ]);
    expect(resolveSnapRegions(pieces, displays[1]!.bounds, 'right')).toEqual([
      expect.objectContaining({ x: 0, y: 100, width: 301, height: 300 }),
    ]);
  });

  it('keeps panels associated with their monitor-specific owner instead of dropping them', () => {
    const provenance = { windowZOrder: 1, sourceProcessId: 42 };
    const windows = splitWindowsSnapCandidate(
      { ...provenance, x: 2600, y: 512, width: 1600, height: 1000, kind: 'window' },
      displays
    );
    const panels = splitWindowsSnapCandidate(
      {
        ...provenance,
        x: 2700,
        y: 600,
        width: 400,
        height: 600,
        kind: 'container',
        controlType: 'Pane',
      },
      displays
    );
    const selected = filterWindowsSnapRegions([...windows, ...panels], 'panel');
    expect(selected.filter((r) => r.kind === 'container')).toEqual(panels);
    expect(selected.filter((r) => r.kind === 'container')).toHaveLength(1);
    expect(panels[0]!.displayId).toBe('primary');
  });

  it('handles negative origins, stacked monitors and 200% scaling without reading another screen', () => {
    const stacked: WindowsSnapDisplay[] = [
      {
        id: 'above',
        bounds: { x: -800, y: -600, width: 800, height: 600 },
        physicalBounds: { x: -1600, y: -1200, width: 1600, height: 1200 },
        scaleFactor: 2,
      },
      {
        id: 'below',
        bounds: { x: -800, y: 0, width: 800, height: 600 },
        physicalBounds: { x: -1600, y: 0, width: 800, height: 600 },
        scaleFactor: 1,
      },
    ];
    expect(
      splitWindowsSnapCandidate({ x: -1500, y: -100, width: 400, height: 200 }, stacked)
    ).toEqual([
      { displayId: 'above', x: -750, y: -50, width: 200, height: 50 },
      { displayId: 'below', x: -700, y: 0, width: 400, height: 100 },
    ]);
    expect(
      splitWindowsSnapCandidate({ x: 5000, y: 5000, width: 100, height: 100 }, stacked)
    ).toEqual([]);
  });

  it('excludes foreign display pieces even if their virtual DIP coordinates overlap', () => {
    const candidates = [
      { displayId: 'a', x: 0, y: 0, width: 400, height: 300 },
      { displayId: 'b', x: 0, y: 0, width: 200, height: 100 },
    ];
    expect(
      resolveSnapRegions(candidates, { x: 0, y: 0, width: 800, height: 600 }, 'a')
    ).toEqual([candidates[0]]);
  });
});
