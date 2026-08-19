import type { Point, Rect, Size } from '../core/geometry/rect.js';

export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface ToolbarPosition extends Point {
  placement: 'above' | 'below' | 'inside';
}

export function clampPoint(point: Point, bounds: Rect): Point {
  return {
    x: Math.min(Math.max(point.x, bounds.x), bounds.x + bounds.width),
    y: Math.min(Math.max(point.y, bounds.y), bounds.y + bounds.height),
  };
}

export function createSelection(start: Point, end: Point, bounds: Rect): Rect {
  const boundedStart = clampPoint(start, bounds);
  const boundedEnd = clampPoint(end, bounds);

  return {
    x: Math.min(boundedStart.x, boundedEnd.x),
    y: Math.min(boundedStart.y, boundedEnd.y),
    width: Math.abs(boundedEnd.x - boundedStart.x),
    height: Math.abs(boundedEnd.y - boundedStart.y),
  };
}

export function moveSelection(selection: Rect, delta: Point, bounds: Rect): Rect {
  const maximumX = bounds.x + Math.max(0, bounds.width - selection.width);
  const maximumY = bounds.y + Math.max(0, bounds.height - selection.height);

  return {
    ...selection,
    x: Math.min(Math.max(selection.x + delta.x, bounds.x), maximumX),
    y: Math.min(Math.max(selection.y + delta.y, bounds.y), maximumY),
  };
}

export function resizeSelection(
  selection: Rect,
  handle: ResizeHandle,
  point: Point,
  bounds: Rect,
  minimumSize: number
): Rect {
  const boundedPoint = clampPoint(point, bounds);
  let left = selection.x;
  let top = selection.y;
  let right = selection.x + selection.width;
  let bottom = selection.y + selection.height;

  if (handle.includes('w')) {
    left = Math.min(boundedPoint.x, right - minimumSize);
    left = Math.max(left, bounds.x);
  }
  if (handle.includes('e')) {
    right = Math.max(boundedPoint.x, left + minimumSize);
    right = Math.min(right, bounds.x + bounds.width);
  }
  if (handle.includes('n')) {
    top = Math.min(boundedPoint.y, bottom - minimumSize);
    top = Math.max(top, bounds.y);
  }
  if (handle.includes('s')) {
    bottom = Math.max(boundedPoint.y, top + minimumSize);
    bottom = Math.min(bottom, bounds.y + bounds.height);
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * 选区使用 CSS Pixel 交互，导出时按捕获帧的真实像素尺寸映射边缘。
 * 左上向下取整、右下向上取整，避免缩放比不是整数时丢失选区边缘像素。
 */
export function viewportRectToImageRect(
  selection: Rect,
  viewportSize: Size,
  imageSize: Size
): Rect {
  assertPositiveSize(viewportSize, 'Viewport');
  assertPositiveSize(imageSize, 'Image');

  const scaleX = imageSize.width / viewportSize.width;
  const scaleY = imageSize.height / viewportSize.height;
  const left = Math.max(0, Math.floor(selection.x * scaleX));
  const top = Math.max(0, Math.floor(selection.y * scaleY));
  const right = Math.min(
    imageSize.width,
    Math.ceil((selection.x + selection.width) * scaleX)
  );
  const bottom = Math.min(
    imageSize.height,
    Math.ceil((selection.y + selection.height) * scaleY)
  );

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** 将 Overlay CSS 坐标换算为 Electron screen 模块使用的全局 DIP 坐标。 */
export function viewportRectToScreenRect(
  selection: Rect,
  viewportSize: Size,
  displayBounds: Rect
): Rect {
  assertPositiveSize(viewportSize, 'Viewport');

  const scaleX = displayBounds.width / viewportSize.width;
  const scaleY = displayBounds.height / viewportSize.height;

  return {
    x: displayBounds.x + selection.x * scaleX,
    y: displayBounds.y + selection.y * scaleY,
    width: selection.width * scaleX,
    height: selection.height * scaleY,
  };
}

export function calculateToolbarPosition(
  selection: Rect,
  viewportSize: Size,
  toolbarSize: Size,
  gap = 10,
  edgePadding = 8
): ToolbarPosition {
  const maximumX = Math.max(
    edgePadding,
    viewportSize.width - toolbarSize.width - edgePadding
  );
  const x = Math.min(
    Math.max(selection.x + selection.width - toolbarSize.width, edgePadding),
    maximumX
  );
  const belowY = selection.y + selection.height + gap;
  if (belowY + toolbarSize.height <= viewportSize.height - edgePadding) {
    return { x, y: belowY, placement: 'below' };
  }

  const aboveY = selection.y - toolbarSize.height - gap;
  if (aboveY >= edgePadding) {
    return { x, y: aboveY, placement: 'above' };
  }

  return {
    x,
    y: Math.min(
      Math.max(selection.y + gap, edgePadding),
      Math.max(edgePadding, viewportSize.height - toolbarSize.height - edgePadding)
    ),
    placement: 'inside',
  };
}

function assertPositiveSize(size: Size, label: string): void {
  if (size.width <= 0 || size.height <= 0) {
    throw new RangeError(`${label} dimensions must be greater than zero.`);
  }
}
