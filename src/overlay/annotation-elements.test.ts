import { describe, expect, it, vi } from 'vitest';
import {
  calculateTextBaselinePosition,
  createDrawableElement,
  getElementBounds,
  getResizeHandleAtPoint,
  hitTestElement,
  isElementResizable,
  measureTextBaselineMetrics,
  measureTextLayout,
  scaleElementToBounds,
  translateElement,
  updateDrawableElement,
  updateElementStyle,
  wrapTextToWidth,
} from './annotation-elements.js';

const style = {
  color: '#f00',
  lineWidth: 4,
  fontSize: 24,
  textStyle: 'default' as const,
  mosaicStrength: 8,
};
const identity = { id: 'element-1', zIndex: 0, createdAt: 1 };

describe('annotation element geometry', () => {
  it('wraps text to the measured selection width', () => {
    const context = {
      font: '12px serif',
      measureText: vi.fn(
        (value: string) => ({ width: value.length * 10 }) as TextMetrics
      ),
    };

    expect(wrapTextToWidth(context, 'ABCDE\n中文', 20, 25)).toBe('AB\nCD\nE\n中文');
    expect(context.font).toBe('12px serif');
  });

  it('creates and updates a normalized rectangle', () => {
    const initial = createDrawableElement(
      'rectangle',
      { x: 80, y: 70 },
      style,
      identity
    );
    expect(
      updateDrawableElement(initial, { x: 80, y: 70 }, { x: 20, y: 10 })
    ).toMatchObject({
      type: 'rectangle',
      bounds: { x: 20, y: 10, width: 60, height: 60 },
    });
  });

  it('hit-tests the topmost element and keeps movement inside the selection', () => {
    const lower = {
      ...createDrawableElement('rectangle', { x: 10, y: 10 }, style, identity),
      bounds: { x: 10, y: 10, width: 30, height: 20 },
    };
    const upper = {
      ...lower,
      id: 'element-2',
      zIndex: 2,
      bounds: { x: 20, y: 15, width: 30, height: 20 },
    };

    expect(hitTestElement([lower, upper], { x: 25, y: 20 }, 2)?.id).toBe('element-2');
    expect(hitTestElement([lower], { x: 25, y: 20 }, 2, 'outline')).toBeUndefined();
    expect(
      translateElement(
        upper,
        { x: 200, y: -100 },
        { x: 0, y: 0, width: 100, height: 80 }
      )
    ).toMatchObject({ bounds: { x: 70, y: 0, width: 30, height: 20 } });
  });

  it('hits visible shape outlines but leaves their empty centers drawable', () => {
    const rectangle = {
      ...createDrawableElement('rectangle', { x: 10, y: 10 }, style, identity),
      bounds: { x: 10, y: 10, width: 80, height: 60 },
    };
    const ellipse = {
      ...createDrawableElement('ellipse', { x: 110, y: 10 }, style, {
        ...identity,
        id: 'ellipse-1',
        zIndex: 1,
      }),
      bounds: { x: 110, y: 10, width: 80, height: 60 },
    };

    expect(hitTestElement([rectangle], { x: 50, y: 10 }, 3, 'outline')).toBe(rectangle);
    expect(hitTestElement([rectangle], { x: 50, y: 40 }, 3, 'outline')).toBeUndefined();
    expect(hitTestElement([ellipse], { x: 190, y: 40 }, 3, 'outline')).toBe(ellipse);
    expect(hitTestElement([ellipse], { x: 150, y: 40 }, 3, 'outline')).toBeUndefined();
  });

  it('hit-tests arrow, brush, text and mosaic drawing areas', () => {
    const arrow = updateDrawableElement(
      createDrawableElement('arrow', { x: 10, y: 10 }, style, identity),
      { x: 10, y: 10 },
      { x: 70, y: 40 }
    );
    const brush = updateDrawableElement(
      createDrawableElement('brush', { x: 10, y: 70 }, style, {
        ...identity,
        id: 'brush-1',
        zIndex: 1,
      }),
      { x: 10, y: 70 },
      { x: 70, y: 90 }
    );
    const text = {
      id: 'text-1',
      type: 'text' as const,
      zIndex: 2,
      createdAt: 1,
      color: '#f00',
      position: { x: 90, y: 40 },
      value: 'Text',
      fontSize: 20,
      metrics: { width: 50, ascent: 16, descent: 4 },
    };
    const mosaic = {
      ...createDrawableElement('mosaic', { x: 90, y: 60 }, style, {
        ...identity,
        id: 'mosaic-1',
        zIndex: 3,
      }),
      bounds: { x: 90, y: 60, width: 50, height: 40 },
    };

    expect(hitTestElement([arrow], { x: 40, y: 25 }, 3)).toBe(arrow);
    expect(hitTestElement([brush], { x: 40, y: 80 }, 3)).toBe(brush);
    expect(hitTestElement([text], { x: 110, y: 30 }, 3)).toBe(text);
    expect(hitTestElement([mosaic], { x: 110, y: 80 }, 3)).toBe(mosaic);
  });

  it('scales brush points into adjusted bounds', () => {
    const brush = {
      ...createDrawableElement('brush', { x: 10, y: 10 }, style, identity),
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 30 },
      ],
    };
    const previousBounds = getElementBounds(brush);
    const scaled = scaleElementToBounds(brush, {
      x: previousBounds.x,
      y: previousBounds.y,
      width: previousBounds.width * 2,
      height: previousBounds.height * 2,
    });

    expect(getElementBounds(scaled).width).toBeGreaterThan(previousBounds.width);
  });

  it('creates a resizable and movable mosaic area', () => {
    const initial = createDrawableElement('mosaic', { x: 80, y: 70 }, style, identity);
    const mosaic = updateDrawableElement(initial, { x: 80, y: 70 }, { x: 20, y: 10 });
    expect(mosaic).toMatchObject({
      type: 'mosaic',
      bounds: { x: 20, y: 10, width: 60, height: 60 },
      blockSize: 8,
    });
    expect(hitTestElement([mosaic], { x: 40, y: 30 }, 2)?.id).toBe('element-1');
    expect(
      translateElement(
        mosaic,
        { x: 100, y: 100 },
        { x: 0, y: 0, width: 120, height: 100 }
      )
    ).toMatchObject({ bounds: { x: 60, y: 40, width: 60, height: 60 } });
    expect(
      scaleElementToBounds(mosaic, { x: 10, y: 10, width: 80, height: 40 })
    ).toMatchObject({ bounds: { x: 10, y: 10, width: 80, height: 40 } });
  });

  it('applies toolbar style to the selected element type', () => {
    const rectangle = {
      ...createDrawableElement('rectangle', { x: 10, y: 10 }, style, identity),
      bounds: { x: 10, y: 10, width: 30, height: 20 },
    };
    expect(
      updateElementStyle(rectangle, { color: '#00f', lineWidth: 8 })
    ).toMatchObject({
      color: '#00f',
      lineWidth: 8,
    });

    const mosaic = createDrawableElement('mosaic', { x: 10, y: 10 }, style, identity);
    expect(
      updateElementStyle(mosaic, { color: '#00f', mosaicStrength: 16 })
    ).toMatchObject({
      color: '#f00',
      bounds: { x: 10, y: 10, width: 0, height: 0 },
      blockSize: 16,
    });
  });

  it('calculates bounds for multiline text', () => {
    expect(
      getElementBounds({
        id: 'text-1',
        type: 'text',
        zIndex: 0,
        createdAt: 1,
        color: '#f00',
        position: { x: 10, y: 40 },
        value: 'Snapora\nTools',
        fontSize: 20,
        metrics: { width: 76, ascent: 16, descent: 4 },
      })
    ).toEqual({ x: 10, y: 24, width: 76, height: 46 });
  });

  it('includes fill padding in text bounds and updates the text preset', () => {
    const text = {
      id: 'text-fill',
      type: 'text' as const,
      zIndex: 0,
      createdAt: 1,
      color: '#ffffff',
      position: { x: 10, y: 40 },
      value: '填充',
      fontSize: 20,
      metrics: { width: 40, ascent: 16, descent: 4 },
      textStyle: 'default' as const,
    };

    const filled = updateElementStyle(text, { textStyle: 'fill' });
    expect(filled).toMatchObject({ textStyle: 'fill' });
    const bounds = getElementBounds(filled);
    expect(bounds.x).toBeCloseTo(4.4);
    expect(bounds.y).toBeCloseTo(18.4);
    expect(bounds.width).toBeCloseTo(51.2);
    expect(bounds.height).toBeCloseTo(31.2);
  });

  it('measures full-width text with the same Canvas font used for rendering', () => {
    const context = {
      font: '12px serif',
      measureText: vi.fn(
        (value: string) =>
          ({
            width: value === '啊啊' ? 48 : value === 'Mg国' ? 56 : 0,
            actualBoundingBoxAscent: value === 'Mg国' ? 20 : 18,
            actualBoundingBoxDescent: value === 'Mg国' ? 6 : 5,
          }) as TextMetrics
      ),
    };

    const metrics = measureTextLayout(context, '啊啊', 24);
    expect(metrics).toEqual({
      width: 48,
      ascent: 20,
      descent: 6,
    });
    expect(
      getElementBounds({
        id: 'text-cjk',
        type: 'text',
        zIndex: 0,
        createdAt: 1,
        color: '#f00',
        position: { x: 12, y: 44 },
        value: '啊啊',
        fontSize: 24,
        metrics,
      })
    ).toEqual({ x: 12, y: 24, width: 48, height: 26 });
    expect(context.font).toBe('12px serif');
    expect(context.measureText).toHaveBeenCalledWith('啊啊');
  });

  it('keeps the committed Canvas baseline aligned with the textarea content', () => {
    const position = calculateTextBaselinePosition(
      { x: 100, y: 60 },
      { width: 48, ascent: 20, descent: 6 },
      { x: 11, y: 9 },
      31.2
    );

    expect(position.x).toBe(111);
    expect(position.y).toBeCloseTo(91.6);
  });

  it('uses the font box baseline used by textarea layout when available', () => {
    const context = {
      font: '12px serif',
      measureText: vi.fn(
        () =>
          ({
            actualBoundingBoxAscent: 20,
            actualBoundingBoxDescent: 6,
            fontBoundingBoxAscent: 23,
            fontBoundingBoxDescent: 7,
          }) as TextMetrics
      ),
    };

    expect(measureTextBaselineMetrics(context, 'Snapora', 24)).toEqual({
      ascent: 23,
      descent: 7,
    });
    expect(context.measureText).toHaveBeenCalledWith('Snapora');
    expect(context.font).toBe('12px serif');
  });

  it('does not expose drag resize for text', () => {
    const text = {
      id: 'text-resize',
      type: 'text' as const,
      zIndex: 0,
      createdAt: 1,
      color: '#f00',
      position: { x: 10, y: 40 },
      value: 'Snapora\nTools',
      fontSize: 20,
      metrics: { width: 76, ascent: 16, descent: 4 },
    };

    expect(isElementResizable(text)).toBe(false);
    expect(getResizeHandleAtPoint(text, { x: 10, y: 24 }, 8)).toBeUndefined();
    expect(
      scaleElementToBounds(text, {
        x: 20,
        y: 30,
        width: 152,
        height: 92,
      })
    ).toBe(text);
  });
});
