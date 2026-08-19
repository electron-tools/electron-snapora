import { contextBridge, ipcRenderer } from 'electron';

import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import { SCREENSHOT_PROTOCOL_VERSION } from '../protocol/messages.js';
import type {
  ScreenshotCompletePayload,
  ScreenshotErrorPayload,
  ScreenshotFeedbackPayload,
  ScreenshotInitializePayload,
  ScreenshotOutputPayload,
  ScreenshotOutputResponse,
} from '../protocol/messages.js';

export interface ScreenshotOverlayApi {
  onInitialize(listener: (payload: ScreenshotInitializePayload) => void): () => void;
  onFeedback(listener: (payload: ScreenshotFeedbackPayload) => void): () => void;
  confirm(payload: Omit<ScreenshotCompletePayload, 'protocolVersion'>): void;
  cancel(jobId: string): void;
  reportError(payload: Omit<ScreenshotErrorPayload, 'protocolVersion'>): void;
  output(
    payload: Omit<ScreenshotOutputPayload, 'protocolVersion'>
  ): Promise<ScreenshotOutputResponse>;
  feedbackReady(): void;
  ready(): void;
  prepared(jobId: string): void;
}

const overlayApi: ScreenshotOverlayApi = {
  onInitialize(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: ScreenshotInitializePayload
    ) => {
      listener(payload);
    };

    ipcRenderer.on(OVERLAY_CHANNELS.initialize, handler);
    return () => {
      ipcRenderer.removeListener(OVERLAY_CHANNELS.initialize, handler);
    };
  },
  onFeedback(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: ScreenshotFeedbackPayload
    ) => {
      listener(payload);
    };

    ipcRenderer.on(OVERLAY_CHANNELS.feedback, handler);
    return () => {
      ipcRenderer.removeListener(OVERLAY_CHANNELS.feedback, handler);
    };
  },
  confirm(payload) {
    ipcRenderer.send(OVERLAY_CHANNELS.confirm, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      ...payload,
    });
  },
  cancel(jobId) {
    ipcRenderer.send(OVERLAY_CHANNELS.cancel, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId,
    });
  },
  reportError(payload) {
    ipcRenderer.send(OVERLAY_CHANNELS.error, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      ...payload,
    });
  },
  output(payload) {
    return ipcRenderer.invoke(OVERLAY_CHANNELS.output, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      ...payload,
    }) as Promise<ScreenshotOutputResponse>;
  },
  feedbackReady() {
    ipcRenderer.send(OVERLAY_CHANNELS.feedbackReady);
  },
  ready() {
    ipcRenderer.send(OVERLAY_CHANNELS.ready, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
    });
  },
  prepared(jobId) {
    ipcRenderer.send(OVERLAY_CHANNELS.prepared, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId,
    });
  },
};

contextBridge.exposeInMainWorld('snaporaOverlay', overlayApi);
