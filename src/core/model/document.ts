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

/** 文字预设对应普通文字、色块填充和阴影；outline 为旧文档兼容值。 */
export type TextStyle = 'default' | 'fill' | 'shadow' | 'outline';

export interface TextElement extends AnnotationElementBase {
  type: 'text';
  position: Point;
  value: string;
  fontSize: number;
  metrics: TextLayoutMetrics;
  /** 缺省时兼容旧文档并按普通文字渲染。 */
  textStyle?: TextStyle;
}

export interface MosaicElement extends AnnotationElementBase {
  type: 'mosaic';
  bounds: Rect;
  /** 马赛克块边长，使用 Image Pixel；缺省时兼容旧文档并回退到 8。 */
  blockSize?: number;
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
