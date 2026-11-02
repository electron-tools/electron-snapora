import type { RecordingOptions, ScreenshotBounds } from '../types.js';
import type { CaptureDisplay } from '../electron/protocol/messages.js';

export const RECORDING_CHANNEL = 'electron-snapora:recording:request';
export const RECORDING_COMMAND = 'electron-snapora:recording:command';

/** Initialization contains geometry and settings only; no host or filesystem capability is exposed. */
export interface RecordingInit {
  nativeVideo?: boolean;
  display: CaptureDisplay;
  selection: ScreenshotBounds;
  options: RecordingOptions;
  locale: string;
  stopShortcut: string;
  hideControls: boolean;
}

/** H.264 AVCC packets from ScreenCaptureKit/VideoToolbox; no raw screen pixels cross main IPC. */
export interface NativeRecordingPacket {
  sequence: number;
  timestamp: number;
  duration: number;
  key: boolean;
  data: Uint8Array;
  config: Uint8Array;
}

export interface RecordingApi {
  request(action: string, payload?: unknown): Promise<unknown>;
  onCommand(listener: (command: 'stop' | 'pause') => void): void;
}
