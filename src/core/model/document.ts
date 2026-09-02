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
  /** 填充预设复用输入框内容区域，确保编辑态与 Canvas 背景边界一致。 */
  fillBounds?: Rect;
  /** 记录输入态容器的真实盒模型边界（Image Pixel），确保选中态、拖拽态与输入态 100% 像素级对齐。 */
  inputBounds?: Rect;
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
