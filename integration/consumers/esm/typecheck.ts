import type { IpcMain } from 'electron';
import {
  ScreenshotManager,
  setupElectronSnapora,
  type ScreenshotResult,
} from 'electron-snapora/main';
import type { ScreenshotRendererApi } from 'electron-snapora/types';

const manager = new ScreenshotManager({ overlayReadyTimeoutMs: 5_000 });
const setup = setupElectronSnapora({
  ipcMain: null as unknown as IpcMain,
  managerOptions: { busyPolicy: 'reject' },
});
const result: Promise<ScreenshotResult> = manager.capture({ locale: 'en-US' });
const rendererApi = null as unknown as ScreenshotRendererApi;

void result;
void setup.preloadPath;
void setup.unregister;
void rendererApi.cancel;
