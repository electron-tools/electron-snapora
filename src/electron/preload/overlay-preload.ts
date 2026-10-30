import { contextBridge, ipcRenderer } from 'electron';

import { OVERLAY_CHANNELS } from '../protocol/channels.js';
import { SCREENSHOT_PROTOCOL_VERSION } from '../protocol/messages.js';
import type {
  ScreenshotCompletePayload,
  ScreenshotErrorPayload,
  ScreenshotFeedbackPayload,
  ScreenshotInitializePayload,
  ScreenshotSnapRegionsPayload,
  ScreenshotSelectionPayload,
  ScreenshotSelectedPayload,
  ScreenshotOutputPayload,
  ScreenshotOutputResponse,
} from '../protocol/messages.js';

export interface ScreenshotOverlayApi {
  onSelectInitialize(
    listener: (payload: ScreenshotSelectionPayload) => void
  ): () => void;
  onReset(listener: () => void): () => void;
  selected(payload: Omit<ScreenshotSelectedPayload, 'protocolVersion'>): void;
  selectionReady(jobId: string): void;
  onInitialize(listener: (payload: ScreenshotInitializePayload) => void): () => void;
  onSnapRegions(listener: (payload: ScreenshotSnapRegionsPayload) => void): () => void;
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
  onSelectInitialize(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: ScreenshotSelectionPayload
    ) => listener(payload);
    ipcRenderer.on(OVERLAY_CHANNELS.selectInitialize, handler);
    return () => ipcRenderer.removeListener(OVERLAY_CHANNELS.selectInitialize, handler);
  },
  onReset(listener) {
    const handler = () => listener();
    ipcRenderer.on(OVERLAY_CHANNELS.reset, handler);
    return () => ipcRenderer.removeListener(OVERLAY_CHANNELS.reset, handler);
  },
  selected(payload) {
    ipcRenderer.send(OVERLAY_CHANNELS.selected, {
      ...payload,
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
    });
  },
  selectionReady(jobId) {
    ipcRenderer.send(OVERLAY_CHANNELS.selectionReady, {
      jobId,
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
    });
  },
  onSnapRegions(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: ScreenshotSnapRegionsPayload
    ) => listener(payload);
    ipcRenderer.on(OVERLAY_CHANNELS.snapRegions, handler);
    return () => ipcRenderer.removeListener(OVERLAY_CHANNELS.snapRegions, handler);
  },
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
