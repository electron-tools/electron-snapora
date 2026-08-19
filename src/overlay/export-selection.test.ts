import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportSelectionPng } from './export-selection.js';

describe('selection PNG export', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws only the selected image rectangle into an offscreen canvas', async () => {
    const drawImage = vi.fn();
    const convertToBlob = vi.fn(
      async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    );
    const OffscreenCanvasMock = vi.fn(
      class {
        getContext = vi.fn(() => ({ drawImage }));
        convertToBlob = convertToBlob;

        constructor(
          readonly width: number,
          readonly height: number
        ) {}
      }
    );
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);
    const source = {} as CanvasImageSource;

    const result = await exportSelectionPng(source, {
      x: 20,
      y: 30,
      width: 120,
      height: 80,
    });

    expect(OffscreenCanvasMock).toHaveBeenCalledWith(120, 80);
    expect(drawImage).toHaveBeenCalledWith(source, 20, 30, 120, 80, 0, 0, 120, 80);
    expect(convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects an empty selection before creating a canvas', async () => {
    await expect(
      exportSelectionPng({} as CanvasImageSource, {
        x: 0,
        y: 0,
        width: 0,
        height: 10,
      })
    ).rejects.toThrow('must not be empty');
  });

  it('composites annotations after cropping the captured frame', async () => {
    const context = {
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      strokeRect: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineCap: 'butt',
      lineJoin: 'miter',
      lineWidth: 1,
    };
    const OffscreenCanvasMock = vi.fn(
      class {
        getContext = vi.fn(() => context);
        convertToBlob = vi.fn(
          async () => new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })
        );

        constructor(
          readonly width: number,
          readonly height: number
        ) {}
      }
    );
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock);

    await exportSelectionPng(
      {} as CanvasImageSource,
      { x: 20, y: 30, width: 120, height: 80 },
      [
        {
          id: 'rectangle-1',
          type: 'rectangle',
          zIndex: 0,
          createdAt: 1,
          color: '#f00',
          lineWidth: 4,
          bounds: { x: 40, y: 45, width: 30, height: 20 },
        },
      ],
      { width: 400, height: 300 }
    );

    expect(context.translate).toHaveBeenCalledWith(-20, -30);
    expect(context.strokeRect).toHaveBeenCalledWith(40, 45, 30, 20);
  });
});
