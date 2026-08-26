import { normalizeRect, type Point, type Rect } from '../core/geometry/rect.js';
import type {
  AnnotationElement,
  ArrowElement,
  BrushElement,
  EllipseElement,
  MosaicElement,
  RectangleElement,
  TextLayoutMetrics,
  TextStyle,
} from '../core/model/document.js';
import type { ScreenshotTool } from '../types.js';
import type { ResizeHandle } from './selection-geometry.js';

export interface AnnotationStyle {
  color: string;
  lineWidth: number;
  fontSize: number;
  textStyle: TextStyle;
  /** 马赛克块边长使用视口像素，创建元素时再换算为图片像素。 */
  mosaicStrength: number;
}

export type AnnotationElementStyle = Partial<AnnotationStyle>;

export const TEXT_LINE_HEIGHT = 1.3;
const TEXT_FILL_PADDING_FACTOR = 0.28;
const TEXT_OUTLINE_WIDTH_FACTOR = 0.1;
const TEXT_SHADOW_PADDING_FACTOR = TEXT_OUTLINE_WIDTH_FACTOR;

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
 * textarea 按实际输入命中的系统字体排版；基线测量必须使用同一行内容，
 * 避免固定中英文样本在 Windows/macOS 触发不同的回退字体并产生偏移。
 */
export function measureTextBaselineMetrics(
  context: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  value: string,
  fontSize: number
): TextBaselineMetrics {
  const previousFont = context.font;
  context.font = getTextCanvasFont(fontSize);
  try {
    const metrics = context.measureText(splitTextLines(value)[0] || 'Mg');
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

/** 按 Canvas 实际测量宽度插入换行，确保最终文字不会超出选区。 */
export function wrapTextToWidth(
  context: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  value: string,
  fontSize: number,
  maximumWidth: number
): string {
  if (maximumWidth <= 0) {
    return value;
  }
  const previousFont = context.font;
  context.font = getTextCanvasFont(fontSize);
  try {
    return splitTextLines(value)
      .flatMap((line) => {
        if (!line) {
          return [''];
        }
        const wrapped: string[] = [];
        let current = '';
        // ponytail: 输入上限为 500 字符；逐字测量优先保证中英文混排宽度准确。
        for (const character of line) {
          const candidate = current + character;
          if (current && context.measureText(candidate).width > maximumWidth) {
            wrapped.push(current);
            current = character;
          } else {
            current = candidate;
          }
        }
        wrapped.push(current);
        return wrapped;
      })
      .join('\n');
  } finally {
    context.font = previousFont;
  }
}

/** 根据所选文字颜色返回清晰可读的黑色或白色对比色。 */
export function getTextContrastColor(color: string): '#111111' | '#ffffff' {
  const normalized = color.trim();
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(normalized);
  if (!match) {
    return '#ffffff';
  }
  const red = Number.parseInt(match[1] ?? '00', 16);
  const green = Number.parseInt(match[2] ?? '00', 16);
  const blue = Number.parseInt(match[3] ?? '00', 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 255000;
  return brightness > 0.62 ? '#111111' : '#ffffff';
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
  tool: Exclude<ScreenshotTool, 'text' | 'watermark'>,
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
        blockSize: style.mosaicStrength,
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
      const textStyle = element.textStyle ?? 'default';
      const decorationPadding =
        textStyle === 'fill'
          ? element.fontSize * TEXT_FILL_PADDING_FACTOR
          : textStyle === 'shadow'
            ? element.fontSize * TEXT_SHADOW_PADDING_FACTOR
          : textStyle === 'outline'
            ? Math.max(2, element.fontSize * TEXT_OUTLINE_WIDTH_FACTOR)
            : 0;
      return {
        x: element.position.x - decorationPadding,
        y: element.position.y - element.metrics.ascent - decorationPadding,
        width: element.metrics.width + decorationPadding * 2,
        height:
          element.metrics.ascent +
          element.metrics.descent +
          element.fontSize * TEXT_LINE_HEIGHT * Math.max(0, lines.length - 1) +
          decorationPadding * 2,
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
      const currentTextStyle = element.textStyle ?? 'default';
      const textStyle = style.textStyle ?? currentTextStyle;
      const scale = fontSize / element.fontSize;
      return color === element.color &&
        fontSize === element.fontSize &&
        textStyle === currentTextStyle
        ? element
        : {
            ...element,
            color,
            fontSize,
            textStyle,
            metrics: scaleTextMetrics(element.metrics, scale),
          };
    }
    case 'mosaic': {
      if (style.mosaicStrength === undefined) {
        return element;
      }
      return style.mosaicStrength === element.blockSize
        ? element
        : { ...element, blockSize: style.mosaicStrength };
    }
  }
}

export function hitTestElement(
  elements: AnnotationElement[],
  point: Point,
  tolerance: number,
  shapeHitMode: 'bounds' | 'outline' = 'bounds'
): AnnotationElement | undefined {
  let hit: AnnotationElement | undefined;
  for (const element of elements) {
    if (
      (!hit || element.zIndex > hit.zIndex) &&
      isPointNearElement(element, point, tolerance, shapeHitMode)
    ) {
      hit = element;
    }
  }
  return hit;
}

export function getResizeHandleAtPoint(
  element: AnnotationElement,
  point: Point,
  tolerance: number
): ResizeHandle | undefined {
  if (!isElementResizable(element)) {
    return undefined;
  }
  const handles = getResizeHandlePoints(getElementBounds(element));
  return (Object.entries(handles) as Array<[ResizeHandle, Point]>).find(
    ([, handlePoint]) => distance(handlePoint, point) <= tolerance
  )?.[0];
}

/** 文字通过字号控件调整大小，不提供容易造成比例失真的拖拽 resize。 */
export function isElementResizable(element: AnnotationElement): boolean {
  return element.type !== 'text';
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
    case 'text':
      return element;
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
  tolerance: number,
  shapeHitMode: 'bounds' | 'outline'
): boolean {
  const bounds = getElementBounds(element);
  if (!isPointInsideExpandedBounds(point, bounds, tolerance)) {
    return false;
  }

  if (element.type === 'arrow' || element.type === 'brush') {
    const points =
      element.type === 'arrow' ? [element.start, element.end] : element.points;
    const lineTolerance = Math.max(tolerance, element.lineWidth / 2 + 2);
    return points.some((current, index) => {
      const next = points[index + 1];
      return next
        ? distanceToSegment(point, current, next) <= lineTolerance
        : distance(point, current) <= lineTolerance;
    });
  }

  if (element.type === 'rectangle' && shapeHitMode === 'outline') {
    const lineTolerance = Math.max(tolerance, element.lineWidth / 2 + 2);
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    return (
      Math.abs(point.x - bounds.x) <= lineTolerance ||
      Math.abs(point.x - right) <= lineTolerance ||
      Math.abs(point.y - bounds.y) <= lineTolerance ||
      Math.abs(point.y - bottom) <= lineTolerance
    );
  }

  if (element.type === 'ellipse' && shapeHitMode === 'outline') {
    return isPointNearEllipseOutline(
      point,
      bounds,
      Math.max(tolerance, element.lineWidth / 2 + 2)
    );
  }

  return true;
}

function isPointInsideExpandedBounds(
  point: Point,
  bounds: Rect,
  tolerance: number
): boolean {
  return (
    point.x >= bounds.x - tolerance &&
    point.x <= bounds.x + bounds.width + tolerance &&
    point.y >= bounds.y - tolerance &&
    point.y <= bounds.y + bounds.height + tolerance
  );
}

function isPointNearEllipseOutline(
  point: Point,
  bounds: Rect,
  tolerance: number
): boolean {
  const radiusX = bounds.width / 2;
  const radiusY = bounds.height / 2;
  if (radiusX <= 0 || radiusY <= 0) {
    return false;
  }
  const deltaX = point.x - (bounds.x + radiusX);
  const deltaY = point.y - (bounds.y + radiusY);
  const radialDistance = Math.hypot(deltaX, deltaY);
  if (radialDistance === 0) {
    return Math.min(radiusX, radiusY) <= tolerance;
  }
  const cosine = deltaX / radialDistance;
  const sine = deltaY / radialDistance;
  const outlineDistance =
    1 /
    Math.sqrt(
      (cosine * cosine) / (radiusX * radiusX) + (sine * sine) / (radiusY * radiusY)
    );
  return Math.abs(radialDistance - outlineDistance) <= tolerance;
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
