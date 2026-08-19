import { describe, expect, it, vi } from 'vitest';
import {
  calculateTextBaselinePosition,
  createDrawableElement,
  getElementBounds,
  hitTestElement,
  measureTextBaselineMetrics,
  measureTextLayout,
  scaleElementToBounds,
  translateElement,
  updateDrawableElement,
  updateElementStyle,
} from './annotation-elements.js';

const style = { color: '#f00', lineWidth: 4, fontSize: 24 };
const identity = { id: 'element-1', zIndex: 0, createdAt: 1 };

describe('annotation element geometry', () => {
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
    expect(
      translateElement(
        upper,
        { x: 200, y: -100 },
        { x: 0, y: 0, width: 100, height: 80 }
      )
    ).toMatchObject({ bounds: { x: 70, y: 0, width: 30, height: 20 } });
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
    expect(updateElementStyle(mosaic, { color: '#00f' })).toMatchObject({
      color: '#f00',
      bounds: { x: 10, y: 10, width: 0, height: 0 },
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

    expect(measureTextBaselineMetrics(context, 24)).toEqual({
      ascent: 23,
      descent: 7,
    });
    expect(context.font).toBe('12px serif');
  });

  it('keeps measured text bounds aligned after proportional resize', () => {
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

    const scaled = scaleElementToBounds(text, {
      x: 20,
      y: 30,
      width: 152,
      height: 92,
    });
    expect(scaled).toMatchObject({
      position: { x: 20, y: 62 },
      fontSize: 40,
      metrics: { width: 152, ascent: 32, descent: 8 },
    });
    expect(getElementBounds(scaled)).toEqual({
      x: 20,
      y: 30,
      width: 152,
      height: 92,
    });
  });
});
