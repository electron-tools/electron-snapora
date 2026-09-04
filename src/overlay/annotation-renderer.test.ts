import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationElement } from '../core/model/document.js';
import { drawAnnotations, getTextFocusBounds } from './annotation-renderer.js';

function createContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 80 }) as TextMetrics),
    drawImage: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
  } as unknown as CanvasRenderingContext2D;
}

const base = { zIndex: 0, createdAt: 1, color: '#f00' };

describe('annotation renderer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders shape, arrow, brush and text elements into a fixed scene', () => {
    const context = createContext();
    const elements: AnnotationElement[] = [
      {
        ...base,
        id: 'rectangle',
        type: 'rectangle',
        bounds: { x: 10, y: 20, width: 30, height: 40 },
        lineWidth: 4,
      },
      {
        ...base,
        id: 'ellipse',
        type: 'ellipse',
        bounds: { x: 50, y: 20, width: 30, height: 20 },
        lineWidth: 4,
      },
      {
        ...base,
        id: 'arrow',
        type: 'arrow',
        start: { x: 10, y: 70 },
        end: { x: 80, y: 70 },
        lineWidth: 4,
      },
      {
        ...base,
        id: 'brush',
        type: 'brush',
        points: [
          { x: 10, y: 80 },
          { x: 30, y: 90 },
        ],
        lineWidth: 4,
      },
      {
        ...base,
        id: 'text',
        type: 'text',
        position: { x: 10, y: 50 },
        value: 'Snapora\nTools',
        fontSize: 24,
        metrics: { width: 96, ascent: 20, descent: 5 },
      },
    ];

    drawAnnotations(context, elements, {
      imageSize: { width: 100, height: 100 },
      clipBounds: { x: 0, y: 0, width: 100, height: 100 },
    });

    expect(context.strokeRect).toHaveBeenCalledWith(10, 20, 30, 40);
    expect(context.ellipse).toHaveBeenCalledWith(65, 30, 15, 10, 0, 0, Math.PI * 2);
    expect(context.lineTo).toHaveBeenCalled();
    expect(context.fillText).toHaveBeenCalledWith('Snapora', 10, 50);
    expect(context.fillText).toHaveBeenCalledWith('Tools', 10, 81.2);
  });

  it('does not render an arrow until the drag establishes a direction', () => {
    const context = createContext();
    drawAnnotations(
      context,
      [
        {
          ...base,
          id: 'arrow-draft',
          type: 'arrow',
          start: { x: 20, y: 20 },
          end: { x: 20, y: 20 },
          lineWidth: 4,
        },
      ],
      { imageSize: { width: 100, height: 100 } }
    );

    expect(context.stroke).not.toHaveBeenCalled();
    expect(context.lineTo).not.toHaveBeenCalled();
  });

  it('renders text fill, shadow, and legacy outline presets', () => {
    const context = createContext();
    const text = {
      ...base,
      position: { x: 10, y: 40 },
      value: 'Snapora',
      fontSize: 24,
      metrics: { width: 90, ascent: 20, descent: 5 },
    };

    drawAnnotations(
      context,
      [
        { ...text, id: 'fill', type: 'text', textStyle: 'fill' },
        { ...text, id: 'shadow', type: 'text', textStyle: 'shadow', zIndex: 1 },
        { ...text, id: 'outline', type: 'text', textStyle: 'outline', zIndex: 2 },
      ],
      { imageSize: { width: 120, height: 80 } }
    );

    expect(context.roundRect).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
    expect(context.strokeText).toHaveBeenCalledWith('Snapora', 10, 40);
    expect(context.fillText).toHaveBeenCalledTimes(3);
  });

  it('renders bright shadow text with a white interior', () => {
    const context = createContext();
    const fillColors: string[] = [];
    const strokeColors: string[] = [];
    vi.mocked(context.fillText).mockImplementation(() => {
      fillColors.push(String(context.fillStyle));
    });
    vi.mocked(context.strokeText).mockImplementation(() => {
      strokeColors.push(String(context.strokeStyle));
    });
    drawAnnotations(
      context,
      [
        {
          ...base,
          id: 'yellow-shadow',
          type: 'text',
          color: '#ffcc00',
          position: { x: 10, y: 40 },
          value: '黄色',
          fontSize: 24,
          metrics: { width: 48, ascent: 20, descent: 5 },
          textStyle: 'shadow',
        },
      ],
      { imageSize: { width: 120, height: 80 } }
    );

    expect(fillColors).toEqual(['#ffffff']);
    expect(strokeColors).toEqual(['#ffcc00']);
  });

  it('clips a pixelated source to a mosaic area and outlines drafts without handles', () => {
    const sampleContext = createContext();
    const OffscreenCanvasMock = vi.fn(
      class {
        constructor(
          readonly width: number,
          readonly height: number
        ) {}

        getContext = vi.fn(() => sampleContext);
      }
    );
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);
    const context = createContext();
    const mosaic: AnnotationElement = {
      ...base,
      id: 'mosaic',
      type: 'mosaic',
      bounds: { x: 20, y: 20, width: 30, height: 25 },
    };

    drawAnnotations(context, [mosaic], {
      imageSize: { width: 100, height: 80 },
      mosaicSource: {} as CanvasImageSource,
      draftElementId: 'mosaic',
      selectionHandleSize: 8,
    });

    expect(OffscreenCanvasMock).toHaveBeenCalledWith(5, 4);
    expect(sampleContext.imageSmoothingEnabled).toBe(true);
    expect(sampleContext.imageSmoothingQuality).toBe('high');
    expect(sampleContext.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      16,
      16,
      40,
      32,
      0,
      0,
      5,
      4
    );
    expect(context.rect).toHaveBeenCalledWith(20, 20, 30, 25);
    expect(context.clip).toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      5,
      4,
      16,
      16,
      40,
      32
    );
    expect(context.fillRect).toHaveBeenCalledOnce();
    expect(context.fillRect).toHaveBeenCalledWith(20, 20, 30, 25);
    expect(context.strokeRect).toHaveBeenCalledTimes(2);
    expect(context.strokeRect).toHaveBeenNthCalledWith(1, 20, 20, 30, 25);
    expect(context.strokeRect).toHaveBeenNthCalledWith(2, 20, 20, 30, 25);
  });

  it('shows resize handles only after a mosaic area is selected', () => {
    const context = createContext();
    const mosaic: AnnotationElement = {
      ...base,
      id: 'mosaic',
      type: 'mosaic',
      bounds: { x: 20, y: 20, width: 30, height: 25 },
    };

    drawAnnotations(context, [mosaic], {
      imageSize: { width: 100, height: 80 },
      selectedElementId: 'mosaic',
      selectionHandleSize: 8,
    });

    expect(context.strokeRect).toHaveBeenCalledWith(20, 20, 30, 25);
    expect(context.arc).toHaveBeenCalledTimes(4);
  });

  it('outlines selected text with breathable rounded border and without resize handles', () => {
    const context = createContext();
    const text: AnnotationElement = {
      ...base,
      id: 'text',
      type: 'text',
      position: { x: 10, y: 40 },
      value: 'Snapora',
      fontSize: 24,
      metrics: { width: 90, ascent: 20, descent: 5 },
    };

    drawAnnotations(context, [text], {
      imageSize: { width: 100, height: 80 },
      selectedElementId: 'text',
      selectionHandleSize: 8,
    });

    expect(context.roundRect).toHaveBeenCalledWith(-4, 8, 122, 56, 8);
    expect(context.stroke).toHaveBeenCalled();
    expect(context.fillRect).not.toHaveBeenCalled();
  });

  it('outlines selected arrow along its axis with start and end handles and without bounding box', () => {
    const context = createContext();
    const arrow: AnnotationElement = {
      ...base,
      id: 'arrow-1',
      type: 'arrow',
      start: { x: 30, y: 40 },
      end: { x: 90, y: 40 },
      lineWidth: 4,
    };

    drawAnnotations(context, [arrow], {
      imageSize: { width: 100, height: 80 },
      selectedElementId: 'arrow-1',
      selectionHandleSize: 8,
    });

    // 对齐 Lark：不绘制外层矩形框
    expect(context.strokeRect).not.toHaveBeenCalled();
    // 仅在起点与终点各绘制一个圆点控制点
    expect(context.arc).toHaveBeenCalledTimes(2);
    // 绘制轴线高亮辅助线
    expect(context.moveTo).toHaveBeenCalledWith(30, 40);
    expect(context.lineTo).toHaveBeenCalledWith(90, 40);
  });

  it('outlines directly moving text and mosaic with the requested color', () => {
    const textContext = createContext();
    const text: AnnotationElement = {
      ...base,
      id: 'text-moving',
      type: 'text',
      position: { x: 10, y: 40 },
      value: 'Snapora',
      fontSize: 24,
      metrics: { width: 90, ascent: 20, descent: 5 },
    };
    drawAnnotations(textContext, [text], {
      imageSize: { width: 160, height: 100 },
      clipBounds: { x: 0, y: 0, width: 160, height: 100 },
      movingElementId: text.id,
      movingOutlineColor: '#6750a4',
      selectionHandleSize: 8,
    });

    expect(textContext.roundRect).toHaveBeenCalledWith(-4, 8, 122, 56, 8);
    expect(textContext.strokeStyle).toBe('#6750a4');
    expect(textContext.stroke).toHaveBeenCalled();
    expect(textContext.fillRect).not.toHaveBeenCalled();

    const mosaicContext = createContext();
    const mosaic: AnnotationElement = {
      ...base,
      id: 'mosaic-moving',
      type: 'mosaic',
      bounds: { x: 20, y: 20, width: 40, height: 30 },
      blockSize: 8,
    };
    drawAnnotations(mosaicContext, [mosaic], {
      imageSize: { width: 160, height: 100 },
      movingElementId: mosaic.id,
      movingOutlineColor: '#6750a4',
      selectionHandleSize: 8,
    });

    expect(mosaicContext.strokeRect).toHaveBeenCalledTimes(2);
    expect(mosaicContext.strokeRect).toHaveBeenCalledWith(20, 20, 40, 30);
    expect(mosaicContext.fillRect).not.toHaveBeenCalled();
  });

  it('renders a tiled watermark across the clipped selection', () => {
    const context = createContext();

    drawAnnotations(context, [], {
      imageSize: { width: 320, height: 180 },
      clipBounds: { x: 20, y: 10, width: 240, height: 120 },
      watermark: {
        text: 'Snapora',
        color: '#ffffff',
        opacity: 0.35,
        fontSize: 18,
      },
    });

    expect(context.rotate).toHaveBeenCalledWith(-Math.PI / 7);
    expect(context.translate).toHaveBeenCalledWith(140, 70);
    expect(context.fillText).toHaveBeenCalled();
    expect(context.globalAlpha).toBe(0.35);
  });

  it('calculates full breathable focus bounds matching input container dimensions', () => {
    const defaultText: AnnotationElement = {
      ...base,
      id: 'text-1',
      type: 'text',
      position: { x: 50, y: 50 },
      value: '2',
      fontSize: 20,
      metrics: { width: 12, ascent: 16, descent: 4 },
    };

    const bounds = getTextFocusBounds(defaultText, 8);
    expect(bounds).toEqual({
      x: 36,
      y: 22,
      width: 48,
      height: 50,
    });

    const fillText: AnnotationElement = {
      ...base,
      id: 'text-fill',
      type: 'text',
      position: { x: 50, y: 50 },
      value: '2',
      fontSize: 20,
      textStyle: 'fill',
      fillBounds: { x: 40, y: 30, width: 60, height: 40 },
      metrics: { width: 12, ascent: 16, descent: 4 },
    };

    const fillFocusBounds = getTextFocusBounds(fillText, 8);
    expect(fillFocusBounds).toEqual({
      x: 36,
      y: 26,
      width: 68,
      height: 48,
    });
  });
});
