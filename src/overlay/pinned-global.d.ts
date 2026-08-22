import type { PinnedImageApi } from '../electron/preload/pinned-preload.js';

declare global {
  interface Window {
    snaporaPinned: PinnedImageApi;
  }
}

export {};
