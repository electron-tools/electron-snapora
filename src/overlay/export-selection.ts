import type { Rect } from '../core/geometry/rect.js';
import type { AnnotationElement } from '../core/model/document.js';
import { drawAnnotations, type WatermarkOptions } from './annotation-renderer.js';

/** 使用不挂载到页面的 Canvas 裁剪捕获帧，工具栏和遮罩不会进入输出图片。 */
export async function exportSelectionPng(
  source: CanvasImageSource,
  imageRect: Rect,
  elements: AnnotationElement[] = [],
  imageSize: { width: number; height: number } = imageRect,
  watermark?: WatermarkOptions
): Promise<Uint8Array> {
  const width = Math.round(imageRect.width);
  const height = Math.round(imageRect.height);
  if (width <= 0 || height <= 0) {
    throw new RangeError('The exported screenshot selection must not be empty.');
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create a 2D canvas context.');
    }

    drawSelection(
      context,
      source,
      imageRect,
      width,
      height,
      elements,
      imageSize,
      watermark
    );
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create a 2D canvas context.');
  }

  drawSelection(
    context,
    source,
    imageRect,
    width,
    height,
    elements,
    imageSize,
    watermark
  );
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
      } else {
        reject(new Error('Unable to encode the screenshot selection as PNG.'));
      }
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function drawSelection(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  imageRect: Rect,
  width: number,
  height: number,
  elements: AnnotationElement[],
  imageSize: { width: number; height: number },
  watermark: WatermarkOptions | undefined
): void {
  context.drawImage(
    source,
    imageRect.x,
    imageRect.y,
    imageRect.width,
    imageRect.height,
    0,
    0,
    width,
    height
  );

  if (elements.length > 0 || watermark) {
    context.save();
    context.translate(-imageRect.x, -imageRect.y);
    drawAnnotations(context, elements, {
      clipBounds: imageRect,
      imageSize,
      mosaicSource: source,
      ...(watermark ? { watermark } : {}),
    });
    context.restore();
  }
}
