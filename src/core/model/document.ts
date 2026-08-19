import type { Point, Rect } from '../geometry/rect.js';

interface AnnotationElementBase {
  id: string;
  zIndex: number;
  createdAt: number;
  color: string;
}

export interface RectangleElement extends AnnotationElementBase {
  type: 'rectangle';
  bounds: Rect;
  lineWidth: number;
}

export interface EllipseElement extends AnnotationElementBase {
  type: 'ellipse';
  bounds: Rect;
  lineWidth: number;
}

export interface ArrowElement extends AnnotationElementBase {
  type: 'arrow';
  start: Point;
  end: Point;
  lineWidth: number;
}

export interface BrushElement extends AnnotationElementBase {
  type: 'brush';
  points: Point[];
  lineWidth: number;
}

export interface TextLayoutMetrics {
  width: number;
  ascent: number;
  descent: number;
}

export interface TextElement extends AnnotationElementBase {
  type: 'text';
  position: Point;
  value: string;
  fontSize: number;
  metrics: TextLayoutMetrics;
}

export interface MosaicElement extends AnnotationElementBase {
  type: 'mosaic';
  bounds: Rect;
}

export type AnnotationElement =
  | RectangleElement
  | EllipseElement
  | ArrowElement
  | BrushElement
  | TextElement
  | MosaicElement;

export interface ScreenshotDocument {
  selection: Rect;
  elements: AnnotationElement[];
}
