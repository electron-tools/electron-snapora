import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationElement } from '../core/model/document.js';
import { drawAnnotations } from './annotation-renderer.js';

function createContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineCap: 'butt',
    lineJoin: 'miter',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
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
    expect(context.fillRect).toHaveBeenCalledTimes(8);
  });
});
