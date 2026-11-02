import type { ScreenshotBounds } from '../types.js';

/** Camera-only presentation settings; never grant media or recorder capabilities. */
export interface CameraStyle {
  shape: 'rectangle' | 'square' | 'circle';
  size: 'small' | 'medium' | 'large';
}

/** Validate renderer settings before applying native window geometry. */
export function parseCameraStyle(value: unknown): CameraStyle {
  const v = value as CameraStyle;
  if (
    !v ||
    !['rectangle', 'square', 'circle'].includes(v.shape) ||
    !['small', 'medium', 'large'].includes(v.size)
  )
    throw new Error('Invalid camera style.');
  return { shape: v.shape, size: v.size };
}

/** Scale all three sizes together in small selections and retain the nearest corner on resize. */
export function cameraBounds(
  area: ScreenshotBounds,
  style: CameraStyle,
  current?: ScreenshotBounds
): ScreenshotBounds {
  const aspect = style.shape === 'rectangle' ? 16 / 9 : 1;
  const scale = Math.min(
    1,
    (area.width * 0.48) / 224,
    (area.height * 0.64 * aspect) / 224
  );
  const width = Math.max(
    1,
    Math.floor({ small: 128, medium: 160, large: 224 }[style.size] * scale)
  );
  const height = Math.max(1, Math.floor(width / aspect));
  const right = !current || current.x + current.width / 2 >= area.x + area.width / 2;
  const bottom = !current || current.y + current.height / 2 >= area.y + area.height / 2;
  const x = current
    ? right
      ? current.x + current.width - width
      : current.x
    : area.x + area.width - width;
  const y = current
    ? bottom
      ? current.y + current.height - height
      : current.y
    : area.y + area.height - height;
  return {
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, x))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, y))),
    width,
    height,
  };
}
