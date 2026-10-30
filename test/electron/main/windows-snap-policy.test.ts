import { describe, expect, it } from 'vitest';
import {
  filterWindowsSnapRegions,
  type WindowsSnapCandidate,
} from '../../../src/electron/main/windows-snap-policy.js';

const window: WindowsSnapCandidate = {
  x: 0,
  y: 0,
  width: 1000,
  height: 800,
  windowZOrder: 0,
  kind: 'window',
  sourceProcessId: 42,
};
const panel: WindowsSnapCandidate = {
  ...window,
  x: 250,
  y: 40,
  width: 750,
  height: 700,
  kind: 'container',
  controlType: 'Pane',
};
const inner: WindowsSnapCandidate = {
  ...panel,
  x: 280,
  y: 100,
  width: 650,
  height: 500,
  controlType: 'Group',
};
const deep: WindowsSnapCandidate = {
  ...inner,
  x: 300,
  y: 120,
  width: 600,
  height: 400,
};
const row: WindowsSnapCandidate = {
  ...panel,
  x: 300,
  y: 200,
  width: 500,
  height: 150,
  controlType: 'ListItem',
};
const buttonWrapper: WindowsSnapCandidate = {
  ...panel,
  x: 300,
  y: 200,
  width: 180,
  height: 120,
  controlType: 'Group',
};
const custom: WindowsSnapCandidate = { ...panel, controlType: 'Custom' };

describe('Windows snap granularity', () => {
  it('window keeps only window boundaries; fine retains original small candidates', () => {
    const input = [window, panel, row, buttonWrapper];
    expect(filterWindowsSnapRegions(input, 'window')).toEqual([window]);
    expect(filterWindowsSnapRegions(input, 'fine')).toEqual(input);
  });
  it('panel excludes rows, custom controls, small groups, and deep containers', () => {
    expect(
      filterWindowsSnapRegions(
        [window, panel, inner, deep, row, buttonWrapper, custom],
        'panel'
      )
    ).toEqual([window, panel, inner]);
  });
  it('collapses near-full-window and nearly identical wrappers without losing sidebars', () => {
    const wrapper = { ...panel, x: 0, y: 0, width: 1000, height: 760 };
    const duplicate = { ...panel, x: 252, width: 748 };
    const sidebar = { ...panel, x: 0, y: 40, width: 200, height: 700 };
    expect(
      filterWindowsSnapRegions([window, wrapper, panel, duplicate, sidebar], 'panel')
    ).toEqual([window, panel, sidebar]);
  });
  it('keeps fallback windows and evaluates negative-coordinate monitors per owner', () => {
    const other = { ...window, x: -1000, windowZOrder: 1, sourceProcessId: 99 };
    const otherPanel = { ...panel, x: -750, windowZOrder: 1, sourceProcessId: 99 };
    const orphan = { ...panel, windowZOrder: 2 };
    expect(
      filterWindowsSnapRegions([otherPanel, window, other, orphan, panel], 'panel')
    ).toEqual([window, other, panel, otherPanel]);
  });
  it('does not mistake unknown control metadata for a major layout panel', () => {
    const unknown: WindowsSnapCandidate = {
      ...window,
      kind: 'container',
      x: 250,
      y: 40,
      width: 750,
      height: 700,
    };
    expect(filterWindowsSnapRegions([window, unknown], 'panel')).toEqual([window]);
  });
});
