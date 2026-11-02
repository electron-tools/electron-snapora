import { describe, it, expect } from 'vitest';
import {
  parseRecordingOptions,
  recordingSize,
  controlPosition,
  preparationPosition,
  RecordingClock,
  DEFAULT_MP4_SECONDS,
  MAX_GIF_SECONDS,
  recordingOutline,
} from '../../src/recording/policy.js';
import { parseScreenshotOptions } from '../../src/electron/protocol/validators.js';

describe('recording policy', () => {
  it('keeps every outline pixel outside capture and on the chosen display, even at fractional DPI', () => {
    const display = { x: -1920, y: -200, width: 1920, height: 1080 };
    for (const region of [
      { x: 12.5, y: 50.25, width: 600.5, height: 350.75 },
      { x: 0, y: 0, width: 600, height: 350 },
      { x: 1300, y: 800, width: 620, height: 280 },
    ]) {
      const outline = recordingOutline(display, region)!;
      expect(outline.lines.length).toBeGreaterThan(0);
      for (const line of outline.lines) {
        const x = outline.bounds.x - display.x + line.x;
        const y = outline.bounds.y - display.y + line.y;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + line.width).toBeLessThanOrEqual(display.width);
        expect(y + line.height).toBeLessThanOrEqual(display.height);
        expect(
          x + line.width <= region.x ||
            x >= region.x + region.width ||
            y + line.height <= region.y ||
            y >= region.y + region.height
        ).toBe(true);
      }
    }
    expect(
      recordingOutline(display, { x: 0, y: 0, width: 1920, height: 1080 })
    ).toBeUndefined();
  });
  it('keeps configurable MP4 defaults and a fixed GIF ceiling', () => {
    expect(DEFAULT_MP4_SECONDS).toBe(3600);
    expect(MAX_GIF_SECONDS).toBe(60);
    for (const value of [0, -1, Infinity, NaN, 1.5, '60', 86401])
      expect(() => parseRecordingOptions({ maxMp4DurationSeconds: value })).toThrow();
    expect(
      parseScreenshotOptions({
        mode: 'record',
        recording: { maxMp4DurationSeconds: 120 },
      })
    ).toMatchObject({
      success: true,
      value: { mode: 'record', recording: { maxMp4DurationSeconds: 120 } },
    });
    expect(parseScreenshotOptions({ recording: { format: 'webm' } }).success).toBe(
      false
    );
    expect(() => parseRecordingOptions({ path: '/tmp/other' })).toThrow();
    expect(() => parseRecordingOptions({ audio: ['none'] })).toThrow();
    expect(
      parseRecordingOptions({
        camera: true,
        microphoneDeviceId: 'mic',
        cameraDeviceId: 'cam',
      })
    ).toMatchObject({ camera: true });
    expect(() => parseRecordingOptions({ camera: 'yes' })).toThrow();
    expect(() => parseRecordingOptions({ cameraDeviceId: 123 })).toThrow();
    expect(() =>
      parseRecordingOptions({ microphoneDeviceId: 'x'.repeat(513) })
    ).toThrow();
  });
  it('subtracts repeated pauses and ignores repeated pause requests', () => {
    const clock = new RecordingClock(1000);
    clock.pause(3000);
    clock.pause(4000);
    expect(clock.seconds(9000)).toBe(2);
    clock.resume(10000);
    clock.resume(12000);
    expect(clock.seconds(13000)).toBe(5);
    clock.pause(14000);
    clock.resume(24000);
    expect(clock.seconds(25000)).toBe(7);
  });
  it('limits output pixels and uses even H264 dimensions', () => {
    expect(recordingSize(3840, 2160, 'mp4')).toEqual({ width: 1920, height: 1080 });
    expect(recordingSize(3840, 2160, 'gif')).toEqual({ width: 1280, height: 720 });
    expect(recordingSize(501, 301, 'mp4')).toEqual({ width: 500, height: 300 });
  });
  it('keeps controls outside a negative-origin display capture and detects fullscreen', () => {
    const d = { x: -1920, y: -100, width: 1920, height: 1080 };
    const p = controlPosition(d, { x: 50, y: 50, width: 800, height: 400 }, 460, 240)!;
    expect(p.x).toBeGreaterThanOrEqual(d.x);
    expect(p).toEqual({ x: -1530, y: 356, width: 460, height: 240 });
    expect(
      controlPosition(d, { x: 0, y: 0, width: 1920, height: 1080 }, 460, 240)
    ).toBeUndefined();
  });
  it('centers preparation and anchors the active bar at the lower right with safe edge fallbacks', () => {
    const d = { x: -1200, y: 40, width: 1200, height: 800 };
    expect(
      preparationPosition(d, { x: 100, y: 100, width: 600, height: 400 }, 440, 272)
    ).toEqual({ x: -1020, y: 204, width: 440, height: 272 });
    expect(
      controlPosition(d, { x: 100, y: 100, width: 600, height: 400 }, 400, 72)
    ).toEqual({ x: -900, y: 546, width: 400, height: 72 });
    const p = controlPosition(
      d,
      { x: 100, y: 500, width: 1000, height: 300 },
      400,
      72
    )!;
    expect(p.y + p.height).toBeLessThan(540);
    expect(
      preparationPosition(d, { x: 0, y: 0, width: 20, height: 20 }, 440, 272)
    ).toEqual({ x: -1200, y: 40, width: 440, height: 272 });
  });
});
