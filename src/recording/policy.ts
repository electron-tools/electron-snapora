import type { RecordingOptions, ScreenshotBounds } from '../types.js';

export const DEFAULT_MP4_SECONDS = 3600;
export const MAX_GIF_SECONDS = 60;

/** Round outwards with a one-DIP gap so fractional DPI sampling cannot include the outline. */
export function recordingOutline(display: ScreenshotBounds, region: ScreenshotBounds) {
  const left = Math.floor(region.x) - 1;
  const top = Math.floor(region.y) - 1;
  const right = Math.ceil(region.x + region.width) + 1;
  const bottom = Math.ceil(region.y + region.height) + 1;
  const bounds = {
    x: Math.max(0, left - 2),
    y: Math.max(0, top - 2),
    width: 0,
    height: 0,
  };
  bounds.width = Math.min(display.width, right + 2) - bounds.x;
  bounds.height = Math.min(display.height, bottom + 2) - bounds.y;
  const lines = [
    { x: left - 2, y: top - 2, width: right - left + 4, height: 2 },
    { x: left - 2, y: bottom, width: right - left + 4, height: 2 },
    { x: left - 2, y: top, width: 2, height: bottom - top },
    { x: right, y: top, width: 2, height: bottom - top },
  ].flatMap((r) => {
    const x = Math.max(0, r.x),
      y = Math.max(0, r.y);
    const width = Math.min(display.width, r.x + r.width) - x;
    const height = Math.min(display.height, r.y + r.height) - y;
    return width > 0 && height > 0
      ? [{ x: x - bounds.x, y: y - bounds.y, width, height }]
      : [];
  });
  return lines.length
    ? { bounds: { ...bounds, x: bounds.x + display.x, y: bounds.y + display.y }, lines }
    : undefined;
}

/** Validate the same bounded settings at both host and recorder IPC boundaries. */
export function parseRecordingOptions(value: unknown): RecordingOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid recording options.');
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).some(
      (k) =>
        ![
          'format',
          'audio',
          'maxMp4DurationSeconds',
          'microphoneDeviceId',
          'camera',
          'cameraDeviceId',
        ].includes(k)
    )
  )
    throw new Error('Unknown recording option.');
  if (r.format !== undefined && r.format !== 'mp4' && r.format !== 'gif')
    throw new Error('Invalid recording format.');
  if (
    r.audio !== undefined &&
    (typeof r.audio !== 'string' ||
      !['none', 'microphone', 'system', 'both'].includes(r.audio))
  )
    throw new Error('Invalid audio mode.');
  if (r.camera !== undefined && typeof r.camera !== 'boolean')
    throw new Error('Invalid camera setting.');
  for (const key of ['microphoneDeviceId', 'cameraDeviceId'])
    if (
      r[key] !== undefined &&
      (typeof r[key] !== 'string' || (r[key] as string).length > 512)
    )
      throw new Error('Invalid media device ID.');
  if (
    r.maxMp4DurationSeconds !== undefined &&
    (!Number.isInteger(r.maxMp4DurationSeconds) ||
      Number(r.maxMp4DurationSeconds) < 1 ||
      Number(r.maxMp4DurationSeconds) > 86400)
  )
    throw new Error('MP4 duration must be 1–86400 seconds.');
  return { ...r } as RecordingOptions;
}

/** Even dimensions keep H.264 encoders compatible; never upscale the selected region. */
export function recordingSize(width: number, height: number, format: 'mp4' | 'gif') {
  const scale = Math.min(1, (format === 'gif' ? 1280 : 1920) / Math.max(width, height));
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}

/** Center preparation over the selection, clamping small or edge selections to the screen. */
export function preparationPosition(
  display: ScreenshotBounds,
  region: ScreenshotBounds,
  width: number,
  height: number
): ScreenshotBounds {
  return {
    x: Math.round(
      display.x +
        Math.max(
          0,
          Math.min(display.width - width, region.x + (region.width - width) / 2)
        )
    ),
    y: Math.round(
      display.y +
        Math.max(
          0,
          Math.min(display.height - height, region.y + (region.height - height) / 2)
        )
    ),
    width,
    height,
  };
}

/** Prefer below the selection's right corner, then adjacent edges; never overlap recorded pixels. */
export function controlPosition(
  display: ScreenshotBounds,
  region: ScreenshotBounds,
  width: number,
  height: number
): ScreenshotBounds | undefined {
  const r = { ...region, x: region.x + display.x, y: region.y + display.y };
  const x = Math.max(
    display.x,
    Math.min(display.x + display.width - width, r.x + r.width - width)
  );
  const y = Math.max(
    display.y,
    Math.min(display.y + display.height - height, r.y + r.height - height)
  );
  const candidates = [
    { x, y: r.y + r.height + 6 },
    { x: r.x + r.width + 6, y },
    { x, y: r.y - height - 6 },
    { x: r.x - width - 6, y },
  ];
  const p = candidates.find(
    (p) =>
      p.x >= display.x &&
      p.y >= display.y &&
      p.x + width <= display.x + display.width &&
      p.y + height <= display.y + display.height
  );
  return p ? { x: Math.round(p.x), y: Math.round(p.y), width, height } : undefined;
}

/** A monotonic active-time clock; pauses never consume the duration budget. */
export class RecordingClock {
  #started: number;
  #pausedAt: number | undefined;
  #paused = 0;
  constructor(now: number) {
    this.#started = now;
  }
  pause(now: number) {
    this.#pausedAt ??= now;
  }
  resume(now: number) {
    if (this.#pausedAt !== undefined) {
      this.#paused += now - this.#pausedAt;
      this.#pausedAt = undefined;
    }
  }
  seconds(now: number) {
    return Math.max(0, ((this.#pausedAt ?? now) - this.#started - this.#paused) / 1000);
  }
}
