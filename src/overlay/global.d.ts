import type { ScreenshotOverlayApi } from '../electron/preload/overlay-preload.js';

declare module '*.css' {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    snaporaOverlay: ScreenshotOverlayApi;
  }
}

export {};
