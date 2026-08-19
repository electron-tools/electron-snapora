import { describe, expect, it } from 'vitest';
import {
  calculateToolbarPosition,
  createSelection,
  moveSelection,
  resizeSelection,
  viewportRectToImageRect,
  viewportRectToScreenRect,
  type ResizeHandle,
} from './selection-geometry.js';

const bounds = { x: 0, y: 0, width: 100, height: 80 };

describe('selection geometry', () => {
  it('normalizes reverse drag and clamps pointer positions to the display', () => {
    expect(createSelection({ x: 90, y: 70 }, { x: -10, y: 10 }, bounds)).toEqual({
      x: 0,
      y: 10,
      width: 90,
      height: 60,
    });
  });

  it('moves the complete selection without crossing display edges', () => {
    const selection = { x: 20, y: 10, width: 30, height: 20 };
    expect(moveSelection(selection, { x: 100, y: -100 }, bounds)).toEqual({
      x: 70,
      y: 0,
      width: 30,
      height: 20,
    });
  });

  it.each<[ResizeHandle, { x: number; y: number }, object]>([
    ['nw', { x: 5, y: 6 }, { x: 5, y: 6, width: 55, height: 44 }],
    ['n', { x: 0, y: 6 }, { x: 20, y: 6, width: 40, height: 44 }],
    ['ne', { x: 90, y: 6 }, { x: 20, y: 6, width: 70, height: 44 }],
    ['e', { x: 90, y: 0 }, { x: 20, y: 10, width: 70, height: 40 }],
    ['se', { x: 90, y: 70 }, { x: 20, y: 10, width: 70, height: 60 }],
    ['s', { x: 0, y: 70 }, { x: 20, y: 10, width: 40, height: 60 }],
    ['sw', { x: 5, y: 70 }, { x: 5, y: 10, width: 55, height: 60 }],
    ['w', { x: 5, y: 0 }, { x: 5, y: 10, width: 55, height: 40 }],
  ])('resizes from the %s handle', (handle, point, expected) => {
    expect(
      resizeSelection({ x: 20, y: 10, width: 40, height: 40 }, handle, point, bounds, 4)
    ).toEqual(expected);
  });

  it('keeps a minimum selection size while resizing', () => {
    expect(
      resizeSelection(
        { x: 20, y: 10, width: 40, height: 40 },
        'nw',
        { x: 80, y: 80 },
        bounds,
        4
      )
    ).toEqual({ x: 56, y: 46, width: 4, height: 4 });
  });

  it('maps CSS pixels to image pixels on a mixed-DPI display', () => {
    expect(
      viewportRectToImageRect(
        { x: 10.2, y: 5.2, width: 30.2, height: 20.2 },
        { width: 100, height: 80 },
        { width: 150, height: 120 }
      )
    ).toEqual({ x: 15, y: 7, width: 46, height: 32 });
  });

  it('maps a high-resolution 2x capture without losing output pixels', () => {
    expect(
      viewportRectToImageRect(
        { x: 100, y: 80, width: 640, height: 360 },
        { width: 2560, height: 1440 },
        { width: 5120, height: 2880 }
      )
    ).toEqual({ x: 200, y: 160, width: 1280, height: 720 });
  });

  it('maps overlay coordinates to global screen DIP including negative origins', () => {
    expect(
      viewportRectToScreenRect(
        { x: 100, y: 50, width: 400, height: 200 },
        { width: 1920, height: 1080 },
        { x: -2560, y: 0, width: 2560, height: 1440 }
      )
    ).toEqual({
      x: -2426.6666666666665,
      y: 66.66666666666666,
      width: 533.3333333333333,
      height: 266.66666666666663,
    });
  });

  it('places the toolbar above a selection near the bottom edge', () => {
    expect(
      calculateToolbarPosition(
        { x: 70, y: 65, width: 25, height: 10 },
        { width: 100, height: 80 },
        { width: 40, height: 20 }
      )
    ).toEqual({ x: 52, y: 35, placement: 'above' });
  });
});
