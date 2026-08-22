import { contextBridge, ipcRenderer } from 'electron';

import type { ScreenshotLocale, ScreenshotMessages } from '../../types.js';
import { PINNED_CHANNELS } from '../protocol/channels.js';

export interface PinnedImagePayload {
  data: Uint8Array;
  mimeType: 'image/png';
  locale: ScreenshotLocale;
  menuLabels: Pick<
    ScreenshotMessages,
    'actions' | 'copy' | 'copied' | 'save' | 'close'
  >;
}

export interface PinnedPoint {
  x: number;
  y: number;
}

export interface PinnedImageApi {
  onInitialize(listener: (payload: PinnedImagePayload) => void): () => void;
  onCopied(listener: () => void): () => void;
  copy(): void;
  save(): void;
  close(): void;
  startDrag(point: PinnedPoint): void;
  moveDrag(point: PinnedPoint): void;
  endDrag(): void;
}

const pinnedApi: PinnedImageApi = {
  onInitialize(listener) {
    const handler = (_event: Electron.IpcRendererEvent, payload: PinnedImagePayload) =>
      listener(payload);
    ipcRenderer.on(PINNED_CHANNELS.initialize, handler);
    return () => ipcRenderer.removeListener(PINNED_CHANNELS.initialize, handler);
  },
  onCopied(listener) {
    const handler = () => listener();
    ipcRenderer.on(PINNED_CHANNELS.copied, handler);
    return () => ipcRenderer.removeListener(PINNED_CHANNELS.copied, handler);
  },
  copy() {
    ipcRenderer.send(PINNED_CHANNELS.copy);
  },
  save() {
    ipcRenderer.send(PINNED_CHANNELS.save);
  },
  close() {
    ipcRenderer.send(PINNED_CHANNELS.close);
  },
  startDrag(point) {
    ipcRenderer.send(PINNED_CHANNELS.dragStart, point);
  },
  moveDrag(point) {
    ipcRenderer.send(PINNED_CHANNELS.dragMove, point);
  },
  endDrag() {
    ipcRenderer.send(PINNED_CHANNELS.dragEnd);
  },
};

contextBridge.exposeInMainWorld('snaporaPinned', pinnedApi);
