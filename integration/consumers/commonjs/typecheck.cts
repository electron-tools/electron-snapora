import snapora = require('electron-snapora/main');
import type { ScreenshotRendererApi } from 'electron-snapora/types';

const manager = new snapora.ScreenshotManager({ overlayReadyTimeoutMs: 5_000 });
const result: Promise<snapora.ScreenshotResult> = manager.capture({
  locale: 'zh-CN',
});
const rendererApi = null as unknown as ScreenshotRendererApi;

void result;
void rendererApi.cancel;
