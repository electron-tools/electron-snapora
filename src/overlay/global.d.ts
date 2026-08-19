import type { ScreenshotOverlayApi } from '../electron/preload/overlay-preload.js';

declare global {
  interface Window {
    snaporaOverlay: ScreenshotOverlayApi;
  }
}

export {};
