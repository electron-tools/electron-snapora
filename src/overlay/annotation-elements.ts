import { normalizeRect, type Point, type Rect } from '../core/geometry/rect.js';
import type {
  AnnotationElement,
  ArrowElement,
  BrushElement,
  EllipseElement,
  MosaicElement,
  RectangleElement,
  TextLayoutMetrics,
} from '../core/model/document.js';
import type { ScreenshotTool } from '../types.js';
import type { ResizeHandle } from './selection-geometry.js';

export interface AnnotationStyle {
  color: string;
  lineWidth: number;
  fontSize: number;
}

export type AnnotationElementStyle = Partial<AnnotationStyle>;

export const TEXT_LINE_HEIGHT = 1.3;

type TextBaselineMetrics = Pick<TextLayoutMetrics, 'ascent' | 'descent'> &
  Partial<Pick<TextLayoutMetrics, 'width'>>;

/**
 * 将 textarea 外框左上角换算为 Canvas fillText 使用的首行基线。
 * DOM 会在内容区内平均分配行高留白，因此需要同时补偿边框、内边距和半行留白。
 */
export function calculateTextBaselinePosition(
  editorOrigin: Point,
  metrics: TextBaselineMetrics,
  contentOffset: Point,
  lineHeight: number
): Point {
  const fontBoxHeight = metrics.ascent + metrics.descent;
  const leadingBeforeBaseline = Math.max(0, lineHeight - fontBoxHeight) / 2;
  return {
    x: editorOrigin.x + contentOffset.x,
    y: editorOrigin.y + contentOffset.y + leadingBeforeBaseline + metrics.ascent,
  };
}

/**
 * textarea 按字体框排版，而元素边界使用实际字形边界；提交时单独读取字体框指标，
 * 避免 Windows 等平台的字体上升部差异让 Canvas 文字相对输入位置上移。
 */
export function measureTextBaselineMetrics(
  context: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  fontSize: number
): TextBaselineMetrics {
  const previousFont = context.font;
  context.font = getTextCanvasFont(fontSize);
  try {
    const metrics = context.measureText('Mg国');
    return {
      ascent: positiveMetric(
        metrics.fontBoundingBoxAscent,
        metrics.actualBoundingBoxAscent,
        fontSize * 0.8
      ),
      descent: positiveMetric(
        metrics.fontBoundingBoxDescent,
        metrics.actualBoundingBoxDescent,
        fontSize * 0.2
      ),
    };
  } finally {
    context.font = previousFont;
  }
}

function positiveMetric(...values: number[]): number {
  return values.find((value) => Number.isFinite(value) && value > 0) ?? 0;
}

export function splitTextLines(value: string): string[] {
  return value.split(/\r?\n/);
}

export function getTextCanvasFont(fontSize: number): string {
  return `600 ${fontSize}px system-ui, sans-serif`;
}

/** 使用与 Canvas 渲染一致的字体测量文字，避免中文等全角字符被固定比例低估。 */
export function measureTextLayout(
  context: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  value: string,
  fontSize: number
): TextLayoutMetrics {
  const previousFont = context.font;
  context.font = getTextCanvasFont(fontSize);
  try {
    const lineMetrics = splitTextLines(value).map((line) => context.measureText(line));
    const referenceMetrics = context.measureText('Mg国');
    return {
      width: Math.max(1, ...lineMetrics.map((metrics) => metrics.width)),
      ascent: Math.max(
        fontSize * 0.8,
        referenceMetrics.actualBoundingBoxAscent,
        ...lineMetrics.map((metrics) => metrics.actualBoundingBoxAscent)
      ),
      descent: Math.max(
        fontSize * 0.2,
        referenceMetrics.actualBoundingBoxDescent,
        ...lineMetrics.map((metrics) => metrics.actualBoundingBoxDescent)
      ),
    };
  } finally {
    context.font = previousFont;
  }
}

interface ElementIdentity {
  id: string;
  zIndex: number;
  createdAt: number;
}

export function createDrawableElement(
  tool: Exclude<ScreenshotTool, 'text'>,
  point: Point,
  style: AnnotationStyle,
  identity: ElementIdentity
): Exclude<AnnotationElement, { type: 'text' }> {
  const base = {
    ...identity,
    color: style.color,
  };

  switch (tool) {
    case 'rectangle':
      return {
        ...base,
        type: 'rectangle',
        bounds: { ...point, width: 0, height: 0 },
        lineWidth: style.lineWidth,
      } satisfies RectangleElement;
    case 'ellipse':
      return {
        ...base,
        type: 'ellipse',
        bounds: { ...point, width: 0, height: 0 },
        lineWidth: style.lineWidth,
      } satisfies EllipseElement;
    case 'arrow':
      return {
        ...base,
        type: 'arrow',
        start: point,
        end: point,
        lineWidth: style.lineWidth,
      } satisfies ArrowElement;
    case 'brush':
      return {
        ...base,
        type: 'brush',
        points: [point],
        lineWidth: style.lineWidth,
      } satisfies BrushElement;
    case 'mosaic':
      return {
        ...base,
        type: 'mosaic',
        bounds: { ...point, width: 0, height: 0 },
      } satisfies MosaicElement;
  }
}

export function updateDrawableElement(
  element: Exclude<AnnotationElement, { type: 'text' }>,
  origin: Point,
  point: Point
): Exclude<AnnotationElement, { type: 'text' }> {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'mosaic':
      return { ...element, bounds: normalizeRect(origin, point) };
    case 'arrow':
      return { ...element, end: point };
    case 'brush':
      return shouldAppendPoint(element.points, point)
        ? { ...element, points: [...element.points, point] }
        : element;
  }
}

export function isDrawableElementValid(element: AnnotationElement): boolean {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'mosaic':
      return element.bounds.width >= 2 && element.bounds.height >= 2;
    case 'arrow':
      return distance(element.start, element.end) >= 2;
    case 'brush':
      return element.points.length >= 2;
    case 'text':
      return element.value.trim().length > 0;
  }
}

export function getElementBounds(element: AnnotationElement): Rect {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'mosaic':
      return element.bounds;
    case 'arrow':
      return paddedBounds([element.start, element.end], element.lineWidth * 2);
    case 'brush':
      return paddedBounds(element.points, element.lineWidth);
    case 'text': {
      const lines = splitTextLines(element.value);
      return {
        x: element.position.x,
        y: element.position.y - element.metrics.ascent,
        width: element.metrics.width,
        height:
          element.metrics.ascent +
          element.metrics.descent +
          element.fontSize * TEXT_LINE_HEIGHT * Math.max(0, lines.length - 1),
      };
    }
  }
}

/** 将工具栏样式应用到已选元素；传入值使用元素模型的 Image Pixel 单位。 */
export function updateElementStyle(
  element: AnnotationElement,
  style: AnnotationElementStyle
): AnnotationElement {
  const color = style.color ?? element.color;

  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'arrow':
    case 'brush': {
      const lineWidth = style.lineWidth ?? element.lineWidth;
      return color === element.color && lineWidth === element.lineWidth
        ? element
        : { ...element, color, lineWidth };
    }
    case 'text': {
      const fontSize = style.fontSize ?? element.fontSize;
      const scale = fontSize / element.fontSize;
      return color === element.color && fontSize === element.fontSize
        ? element
        : {
            ...element,
            color,
            fontSize,
            metrics: scaleTextMetrics(element.metrics, scale),
          };
    }
    case 'mosaic':
      return element;
  }
}

export function hitTestElement(
  elements: AnnotationElement[],
  point: Point,
  tolerance: number
): AnnotationElement | undefined {
  return [...elements]
    .sort((left, right) => right.zIndex - left.zIndex)
    .find((element) => isPointNearElement(element, point, tolerance));
}

export function getResizeHandleAtPoint(
  element: AnnotationElement,
  point: Point,
  tolerance: number
): ResizeHandle | undefined {
  const handles = getResizeHandlePoints(getElementBounds(element));
  return (Object.entries(handles) as Array<[ResizeHandle, Point]>).find(
    ([, handlePoint]) => distance(handlePoint, point) <= tolerance
  )?.[0];
}

export function getResizeHandlePoints(bounds: Rect): Record<ResizeHandle, Point> {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;

  return {
    nw: { x: bounds.x, y: bounds.y },
    n: { x: centerX, y: bounds.y },
    ne: { x: right, y: bounds.y },
    e: { x: right, y: centerY },
    se: { x: right, y: bottom },
    s: { x: centerX, y: bottom },
    sw: { x: bounds.x, y: bottom },
    w: { x: bounds.x, y: centerY },
  };
}

export function translateElement(
  element: AnnotationElement,
  delta: Point,
  bounds: Rect
): AnnotationElement {
  const elementBounds = getElementBounds(element);
  const minimumX = bounds.x - elementBounds.x;
  const maximumX = bounds.x + bounds.width - (elementBounds.x + elementBounds.width);
  const minimumY = bounds.y - elementBounds.y;
  const maximumY = bounds.y + bounds.height - (elementBounds.y + elementBounds.height);
  const boundedDelta = {
    x: Math.min(Math.max(delta.x, minimumX), maximumX),
    y: Math.min(Math.max(delta.y, minimumY), maximumY),
  };

  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'mosaic':
      return {
        ...element,
        bounds: {
          ...element.bounds,
          x: element.bounds.x + boundedDelta.x,
          y: element.bounds.y + boundedDelta.y,
        },
      };
    case 'arrow':
      return {
        ...element,
        start: addPoint(element.start, boundedDelta),
        end: addPoint(element.end, boundedDelta),
      };
    case 'brush':
      return {
        ...element,
        points: element.points.map((point) => addPoint(point, boundedDelta)),
      };
    case 'text':
      return { ...element, position: addPoint(element.position, boundedDelta) };
  }
}

export function scaleElementToBounds(
  element: AnnotationElement,
  nextBounds: Rect
): AnnotationElement {
  const previousBounds = getElementBounds(element);
  const mapPoint = (point: Point): Point => ({
    x:
      nextBounds.x +
      ((point.x - previousBounds.x) / Math.max(previousBounds.width, 1)) *
        nextBounds.width,
    y:
      nextBounds.y +
      ((point.y - previousBounds.y) / Math.max(previousBounds.height, 1)) *
        nextBounds.height,
  });

  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'mosaic':
      return { ...element, bounds: nextBounds };
    case 'arrow':
      return { ...element, start: mapPoint(element.start), end: mapPoint(element.end) };
    case 'brush':
      return { ...element, points: element.points.map(mapPoint) };
    case 'text': {
      const scale = nextBounds.height / Math.max(previousBounds.height, 1);
      const fontSize = Math.max(8, element.fontSize * scale);
      const actualScale = fontSize / element.fontSize;
      return {
        ...element,
        position: mapPoint(element.position),
        fontSize,
        metrics: scaleTextMetrics(element.metrics, actualScale),
      };
    }
  }
}

function scaleTextMetrics(
  metrics: TextLayoutMetrics,
  scale: number
): TextLayoutMetrics {
  return {
    width: metrics.width * scale,
    ascent: metrics.ascent * scale,
    descent: metrics.descent * scale,
  };
}

function isPointNearElement(
  element: AnnotationElement,
  point: Point,
  tolerance: number
): boolean {
  if (element.type === 'arrow' || element.type === 'brush') {
    const points =
      element.type === 'arrow' ? [element.start, element.end] : element.points;
    return points.some((current, index) => {
      const next = points[index + 1];
      return next
        ? distanceToSegment(point, current, next) <= tolerance
        : distance(point, current) <= tolerance;
    });
  }

  const bounds = getElementBounds(element);
  return (
    point.x >= bounds.x - tolerance &&
    point.x <= bounds.x + bounds.width + tolerance &&
    point.y >= bounds.y - tolerance &&
    point.y <= bounds.y + bounds.height + tolerance
  );
}

function paddedBounds(points: Point[], padding: number): Rect {
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const left = Math.min(...xValues) - padding;
  const top = Math.min(...yValues) - padding;
  const right = Math.max(...xValues) + padding;
  const bottom = Math.max(...yValues) + padding;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function shouldAppendPoint(points: Point[], point: Point): boolean {
  const previous = points.at(-1);
  return !previous || distance(previous, point) >= 0.75;
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) {
    return distance(point, start);
  }

  const ratio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * (end.x - start.x) +
        (point.y - start.y) * (end.y - start.y)) /
        lengthSquared
    )
  );
  return distance(point, {
    x: start.x + ratio * (end.x - start.x),
    y: start.y + ratio * (end.y - start.y),
  });
}

function addPoint(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y };
}
