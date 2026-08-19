export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Rect = Point & Size;

export function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function clampRect(rect: Rect, bounds: Rect): Rect {
  const left = Math.max(bounds.x, rect.x);
  const top = Math.max(bounds.y, rect.y);
  const right = Math.min(bounds.x + bounds.width, rect.x + rect.width);
  const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height);

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function isRectValid(rect: Rect, minimumSize = 1): boolean {
  return rect.width >= minimumSize && rect.height >= minimumSize;
}

export function viewportPointToImagePoint(
  point: Point,
  viewportSize: Size,
  imageSize: Size
): Point {
  if (viewportSize.width <= 0 || viewportSize.height <= 0) {
    throw new RangeError('Viewport dimensions must be greater than zero.');
  }

  return {
    x: point.x * (imageSize.width / viewportSize.width),
    y: point.y * (imageSize.height / viewportSize.height),
  };
}
