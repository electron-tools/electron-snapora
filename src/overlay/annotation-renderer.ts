import type { Rect, Size } from '../core/geometry/rect.js';
import type {
  AnnotationElement,
  ArrowElement,
  MosaicElement,
  TextElement,
} from '../core/model/document.js';
import {
  getElementBounds,
  getResizeHandlePoints,
  getTextCanvasFont,
  getTextContrastColor,
  getTextEditorLayout,
  getTextFillColor,
  getTextStrokeWidth,
  isElementResizable,
  splitTextLines,
  TEXT_LINE_HEIGHT,
} from './annotation-elements.js';

export type AnnotationDrawingContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const DEFAULT_MOSAIC_BLOCK_SIZE = 8;

/** 水印是覆盖整个选区的渲染配置，不参与单个标注元素的选中和缩放。 */
export interface WatermarkOptions {
  text: string;
  color: string;
  opacity: number;
  fontSize: number;
}

export interface DrawAnnotationsOptions {
  clipBounds?: Rect;
  imageSize: Size;
  mosaicSource?: CanvasImageSource;
  draftElementId?: string | null;
  movingElementId?: string | null;
  movingOutlineColor?: string;
  selectedElementId?: string | null;
  selectionHandleSize?: number;
  watermark?: WatermarkOptions;
}

export function drawAnnotations(
  context: AnnotationDrawingContext,
  elements: AnnotationElement[],
  options: DrawAnnotationsOptions
): void {
  context.save();
  if (options.clipBounds) {
    context.beginPath();
    context.rect(
      options.clipBounds.x,
      options.clipBounds.y,
      options.clipBounds.width,
      options.clipBounds.height
    );
    context.clip();
  }

  for (const element of [...elements].sort(
    (left, right) => left.zIndex - right.zIndex
  )) {
    drawElement(context, element, options);
  }
  if (options.watermark?.text.trim()) {
    drawWatermark(
      context,
      options.watermark,
      options.clipBounds ?? { x: 0, y: 0, ...options.imageSize }
    );
  }
  const moving = elements.find((element) => element.id === options.movingElementId);
  if (moving) {
    if (moving.type === 'text') {
      drawTextFocusOutline(
        context,
        moving,
        options.selectionHandleSize ?? 8,
        options.movingOutlineColor ?? '#0a84ff'
      );
    } else {
      drawMovingOutline(
        context,
        getElementBounds(moving),
        options.selectionHandleSize ?? 8,
        options.movingOutlineColor ?? '#0a84ff'
      );
    }
  }
  context.restore();

  const draft = elements.find((element) => element.id === options.draftElementId);
  if (draft?.type === 'mosaic') {
    drawDraftOutline(
      context,
      getElementBounds(draft),
      options.selectionHandleSize ?? 8
    );
  }

  const selected = elements.find((element) => element.id === options.selectedElementId);
  if (selected) {
    if (selected.type === 'text') {
      drawTextFocusOutline(
        context,
        selected,
        options.selectionHandleSize ?? 8,
        options.movingOutlineColor ?? '#0a84ff'
      );
    } else if (selected.type === 'arrow') {
      drawArrowSelectionOutline(
        context,
        selected,
        options.selectionHandleSize ?? 8
      );
    } else {
      drawSelectionOutline(
        context,
        getElementBounds(selected),
        options.selectionHandleSize ?? 8,
        isElementResizable(selected)
      );
    }
  }
}

function drawElement(
  context: AnnotationDrawingContext,
  element: AnnotationElement,
  options: DrawAnnotationsOptions
): void {
  context.save();
  context.strokeStyle = element.color;
  context.fillStyle = element.color;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  switch (element.type) {
    case 'rectangle':
      context.lineWidth = element.lineWidth;
      context.strokeRect(
        element.bounds.x,
        element.bounds.y,
        element.bounds.width,
        element.bounds.height
      );
      break;
    case 'ellipse':
      context.lineWidth = element.lineWidth;
      context.beginPath();
      context.ellipse(
        element.bounds.x + element.bounds.width / 2,
        element.bounds.y + element.bounds.height / 2,
        element.bounds.width / 2,
        element.bounds.height / 2,
        0,
        0,
        Math.PI * 2
      );
      context.stroke();
      break;
    case 'arrow':
      drawArrow(
        context,
        element.start.x,
        element.start.y,
        element.end.x,
        element.end.y,
        element.lineWidth
      );
      break;
    case 'brush':
      context.lineWidth = element.lineWidth;
      drawPolyline(context, element.points);
      break;
    case 'text':
      drawText(context, element);
      break;
    case 'mosaic':
      if (options.mosaicSource) {
        drawMosaic(context, element, options.mosaicSource, options.imageSize);
      }
      break;
  }
  context.restore();
}

function drawArrow(
  context: AnnotationDrawingContext,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  lineWidth: number
): void {
  // 按下但尚未形成方向时不渲染零长度箭头，避免箭头头部瞬间闪烁。
  if (Math.hypot(endX - startX, endY - startY) < 2) {
    return;
  }
  const angle = Math.atan2(endY - startY, endX - startX);
  const headLength = Math.max(12, lineWidth * 4);
  context.lineWidth = lineWidth;
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.lineTo(
    endX - headLength * Math.cos(angle - Math.PI / 6),
    endY - headLength * Math.sin(angle - Math.PI / 6)
  );
  context.moveTo(endX, endY);
  context.lineTo(
    endX - headLength * Math.cos(angle + Math.PI / 6),
    endY - headLength * Math.sin(angle + Math.PI / 6)
  );
  context.stroke();
}

/** 按文字预设绘制普通文字、色块填充、阴影或兼容旧文档的描边。 */
function drawText(context: AnnotationDrawingContext, element: TextElement): void {
  const textStyle = element.textStyle ?? 'default';
  const contrastColor = getTextContrastColor(element.color);
  const textFillColor = getTextFillColor(textStyle, element.color);
  if (textStyle === 'fill') {
    const bounds = getElementBounds(element);
    context.fillStyle = element.color;
    context.beginPath();
    context.roundRect(
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      Math.max(4, element.fontSize * 0.22)
    );
    context.fill();
    context.fillStyle = textFillColor;
  } else if (textStyle === 'shadow') {
    context.fillStyle = textFillColor;
    context.strokeStyle = element.color;
    context.lineWidth = getTextStrokeWidth(element.fontSize);
    context.lineJoin = 'round';
    context.lineCap = 'round';
  } else {
    context.fillStyle = element.color;
  }

  context.font = getTextCanvasFont(element.fontSize);
  context.textBaseline = 'alphabetic';
  if (textStyle === 'outline') {
    context.strokeStyle = contrastColor;
    context.lineWidth = getTextStrokeWidth(element.fontSize);
    context.lineJoin = 'round';
    context.lineCap = 'round';
  }
  splitTextLines(element.value).forEach((line, index) => {
    const y = element.position.y + index * element.fontSize * TEXT_LINE_HEIGHT;
    if (textStyle === 'shadow' || textStyle === 'outline') {
      context.strokeText(line, element.position.x, y);
    }
    context.fillText(line, element.position.x, y);
  });
}

function drawPolyline(
  context: AnnotationDrawingContext,
  points: Array<{ x: number; y: number }>
): void {
  const first = points[0];
  if (!first) {
    return;
  }
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function drawMosaic(
  context: AnnotationDrawingContext,
  element: MosaicElement,
  source: CanvasImageSource,
  imageSize: Size
): void {
  const blockSize = Math.max(2, element.blockSize ?? DEFAULT_MOSAIC_BLOCK_SIZE);
  // 只采样马赛克周边，并将网格对齐到整张图片，移动或缩放后块不会漂移。
  const sourceX = Math.max(0, Math.floor(element.bounds.x / blockSize) * blockSize);
  const sourceY = Math.max(0, Math.floor(element.bounds.y / blockSize) * blockSize);
  const sourceRight = Math.min(
    imageSize.width,
    Math.ceil((element.bounds.x + element.bounds.width) / blockSize) * blockSize
  );
  const sourceBottom = Math.min(
    imageSize.height,
    Math.ceil((element.bounds.y + element.bounds.height) / blockSize) * blockSize
  );
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }
  const sampleWidth = Math.max(1, Math.ceil(sourceWidth / blockSize));
  const sampleHeight = Math.max(1, Math.ceil(sourceHeight / blockSize));
  const sampleCanvas = createRasterCanvas(sampleWidth, sampleHeight);
  const sampleContext = sampleCanvas.getContext('2d');
  if (!sampleContext) {
    return;
  }

  // 缩小时使用高质量平均色，避免单点取样把一整块错误放大成纯白或纯灰。
  sampleContext.imageSmoothingEnabled = true;
  sampleContext.imageSmoothingQuality = 'high';
  sampleContext.drawImage(
    source,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sampleWidth,
    sampleHeight
  );

  context.save();
  context.beginPath();
  context.rect(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height
  );
  context.clip();
  context.imageSmoothingEnabled = false;
  context.drawImage(
    sampleCanvas,
    0,
    0,
    sampleWidth,
    sampleHeight,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight
  );
  context.restore();
}

/** 以错行斜排方式覆盖选区，保持小选区和高 DPI 导出时都有稳定密度。 */
function drawWatermark(
  context: AnnotationDrawingContext,
  watermark: WatermarkOptions,
  bounds: Rect
): void {
  const text = watermark.text.trim();
  if (!text || bounds.width <= 0 || bounds.height <= 0) {
    return;
  }

  const fontSize = Math.max(12, watermark.fontSize);
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0.05, watermark.opacity));
  context.fillStyle = watermark.color;
  context.font = getTextCanvasFont(fontSize);
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const diagonal = Math.hypot(bounds.width, bounds.height);
  const columnGap = Math.max(
    context.measureText(text).width + fontSize * 4,
    fontSize * 10
  );
  const rowGap = fontSize * 4.5;
  context.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  context.rotate(-Math.PI / 7);

  let row = 0;
  for (let y = -diagonal; y <= diagonal; y += rowGap) {
    const offset = row % 2 === 0 ? 0 : columnGap / 2;
    for (let x = -diagonal; x <= diagonal; x += columnGap) {
      context.fillText(text, x + offset, y);
    }
    row += 1;
  }
  context.restore();
}

/** 绘制过程中用半透明底色和双层边框强调范围，不提前暴露移动和缩放控制点。 */
function drawDraftOutline(
  context: AnnotationDrawingContext,
  bounds: Rect,
  handleSize: number
): void {
  context.save();
  context.fillStyle = 'rgba(10, 132, 255, 0.24)';
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.strokeStyle = 'rgba(0, 0, 0, 0.78)';
  context.lineWidth = Math.max(3.5, handleSize / 2);
  context.setLineDash([]);
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.strokeStyle = '#53b5ff';
  context.lineWidth = Math.max(1.5, handleSize / 5);
  context.setLineDash([handleSize * 0.75, handleSize * 0.5]);
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.setLineDash([]);
  context.restore();
}

/** 马赛克等图形直接拖动时用主题强调色标明真实边界，不显示缩放控制点。 */
function drawMovingOutline(
  context: AnnotationDrawingContext,
  bounds: Rect,
  handleSize: number,
  color: string
): void {
  context.save();
  context.strokeStyle = 'rgba(0, 0, 0, 0.68)';
  context.lineWidth = Math.max(3, handleSize / 2);
  context.setLineDash([]);
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.strokeStyle = color;
  context.lineWidth = Math.max(1.5, handleSize / 5);
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.restore();
}

/**
 * 计算文字标注在输入态、选中态或拖拽态时的完整外框区域。
 * 严格按照 .text-editor-container (border: 2px, padding: 4px) 与 .text-editor (padding: 6px 8px, min-width: 36px, min-height: 32px, line-height: 1.3)
 * 的 DOM 布局盒模型还原真实外框，确保选中态/拖拽态与输入态 100% 像素级对齐。
 */
export function getTextFocusBounds(
  element: TextElement,
  handleSize: number
): Rect {
  const scale = handleSize / 8;

  // 优先直接使用输入确认时永久保存的真实 DOM 容器外框（经平移后），保证 100% 像素级无缝对齐
  if (element.inputBounds) {
    return {
      x: element.inputBounds.x,
      y: element.inputBounds.y,
      width: element.inputBounds.width,
      height: element.inputBounds.height,
    };
  }

  if (element.textStyle === 'fill' && element.fillBounds) {
    return {
      x: element.fillBounds.x - 4 * scale,
      y: element.fillBounds.y - 4 * scale,
      width: element.fillBounds.width + 8 * scale,
      height: element.fillBounds.height + 8 * scale,
    };
  }

  const lines = splitTextLines(element.value);
  const layout = getTextEditorLayout(
    element.metrics.width,
    lines.length,
    element.fontSize,
    scale
  );

  return {
    x: element.position.x - layout.offsetToBaseline.x,
    y: element.position.y - element.metrics.ascent - layout.offsetToBaseline.y,
    width: layout.containerWidth,
    height: layout.containerHeight,
  };
}

/**
 * 文字标注在选中或拖拽时呈现与输入态完全一致的外框：
 * 4px 呼吸间距、8px 圆角、2px 实线主题强调色外边框。
 */
function drawTextFocusOutline(
  context: AnnotationDrawingContext,
  element: TextElement,
  handleSize: number,
  color: string
): void {
  const scale = handleSize / 8;
  const radius = 8 * scale;
  const lineWidth = Math.max(2, 2 * scale);
  const focusBounds = getTextFocusBounds(element, handleSize);

  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.setLineDash([]);
  strokeRoundedRect(
    context,
    focusBounds.x,
    focusBounds.y,
    focusBounds.width,
    focusBounds.height,
    radius
  );
  context.restore();
}

function strokeRoundedRect(
  context: AnnotationDrawingContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, radius);
  } else {
    const r = Math.min(radius, width / 2, height / 2);
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }
  context.stroke();
}

function drawSelectionOutline(
  context: AnnotationDrawingContext,
  bounds: Rect,
  handleSize: number,
  showResizeHandles: boolean
): void {
  context.save();
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(1, handleSize / 8);
  context.setLineDash([handleSize, handleSize / 2]);
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.setLineDash([]);

  if (showResizeHandles) {
    const handleRadius = Math.max(3.5, handleSize / 2);
    for (const point of Object.values(getResizeHandlePoints(bounds))) {
      if (!point) {
        continue;
      }
      context.beginPath();
      context.arc(point.x, point.y, handleRadius, 0, Math.PI * 2);
      context.fillStyle = '#ffffff';
      context.fill();
      context.lineWidth = Math.max(1.5, handleSize / 4);
      context.strokeStyle = '#0a84ff';
      context.stroke();
    }
  }
  context.restore();
}

/**
 * 绘制箭头元素的选中态（对齐 Lark 交互体验）：
 * 1. 沿箭头轴线绘制居中辅助线（#0a84ff）；
 * 2. 仅在起止两端（start 与 end）绘制圆形控制点（白底蓝边），不绘制外层矩形虚线框；
 * 3. 支持向两端自由拉伸或改变旋转角度。
 */
function drawArrowSelectionOutline(
  context: AnnotationDrawingContext,
  element: ArrowElement,
  handleSize: number
): void {
  context.save();

  // 1. 沿起点到终点轴线绘制辅助高亮线
  context.beginPath();
  context.moveTo(element.start.x, element.start.y);
  context.lineTo(element.end.x, element.end.y);
  context.strokeStyle = '#0a84ff';
  context.lineWidth = Math.max(1.5, handleSize / 4);
  context.stroke();

  // 2. 在起点和终点各绘制一个圆形控制点
  const handleRadius = Math.max(3.5, handleSize / 2);
  const handlePoints = [element.start, element.end];
  for (const point of handlePoints) {
    context.beginPath();
    context.arc(point.x, point.y, handleRadius, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();
    context.lineWidth = Math.max(1.5, handleSize / 4);
    context.strokeStyle = '#0a84ff';
    context.stroke();
  }

  context.restore();
}

function createRasterCanvas(
  width: number,
  height: number
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
