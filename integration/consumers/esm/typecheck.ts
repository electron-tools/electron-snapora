import { ScreenshotManager, type ScreenshotResult } from 'electron-snapora/main';
import type { ScreenshotRendererApi } from 'electron-snapora/types';

const manager = new ScreenshotManager({ overlayReadyTimeoutMs: 5_000 });
const result: Promise<ScreenshotResult> = manager.capture({ locale: 'en-US' });
const rendererApi = null as unknown as ScreenshotRendererApi;

void result;
void rendererApi.cancel;
