import type { Rect, Size } from '../core/geometry/rect.js';
import type { AnnotationElement, MosaicElement } from '../core/model/document.js';
import {
  getElementBounds,
  getResizeHandlePoints,
  getTextCanvasFont,
  splitTextLines,
  TEXT_LINE_HEIGHT,
} from './annotation-elements.js';

export type AnnotationDrawingContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MOSAIC_BLOCK_SIZE = 8;

export interface DrawAnnotationsOptions {
  clipBounds?: Rect;
  imageSize: Size;
  mosaicSource?: CanvasImageSource;
  draftElementId?: string | null;
  selectedElementId?: string | null;
  selectionHandleSize?: number;
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
    drawSelectionOutline(
      context,
      getElementBounds(selected),
      options.selectionHandleSize ?? 8
    );
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
      context.font = getTextCanvasFont(element.fontSize);
      context.textBaseline = 'alphabetic';
      splitTextLines(element.value).forEach((line, index) => {
        context.fillText(
          line,
          element.position.x,
          element.position.y + index * element.fontSize * TEXT_LINE_HEIGHT
        );
      });
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
  // 只采样马赛克周边，并将网格对齐到整张图片，移动或缩放后块不会漂移。
  const sourceX = Math.max(
    0,
    Math.floor(element.bounds.x / MOSAIC_BLOCK_SIZE) * MOSAIC_BLOCK_SIZE
  );
  const sourceY = Math.max(
    0,
    Math.floor(element.bounds.y / MOSAIC_BLOCK_SIZE) * MOSAIC_BLOCK_SIZE
  );
  const sourceRight = Math.min(
    imageSize.width,
    Math.ceil((element.bounds.x + element.bounds.width) / MOSAIC_BLOCK_SIZE) *
      MOSAIC_BLOCK_SIZE
  );
  const sourceBottom = Math.min(
    imageSize.height,
    Math.ceil((element.bounds.y + element.bounds.height) / MOSAIC_BLOCK_SIZE) *
      MOSAIC_BLOCK_SIZE
  );
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }
  const sampleWidth = Math.max(1, Math.ceil(sourceWidth / MOSAIC_BLOCK_SIZE));
  const sampleHeight = Math.max(1, Math.ceil(sourceHeight / MOSAIC_BLOCK_SIZE));
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

function drawSelectionOutline(
  context: AnnotationDrawingContext,
  bounds: Rect,
  handleSize: number
): void {
  context.save();
  context.strokeStyle = '#ffffff';
  context.fillStyle = '#35a7ff';
  context.lineWidth = Math.max(1, handleSize / 8);
  context.setLineDash([handleSize, handleSize / 2]);
  context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.setLineDash([]);

  for (const point of Object.values(getResizeHandlePoints(bounds))) {
    context.fillRect(
      point.x - handleSize / 2,
      point.y - handleSize / 2,
      handleSize,
      handleSize
    );
    context.strokeRect(
      point.x - handleSize / 2,
      point.y - handleSize / 2,
      handleSize,
      handleSize
    );
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
