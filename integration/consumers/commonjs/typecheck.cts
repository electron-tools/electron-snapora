import snapora = require('electron-snapora/main');
import type { IpcMain } from 'electron';
import type { ScreenshotRendererApi } from 'electron-snapora/types';

const manager = new snapora.ScreenshotManager({ overlayReadyTimeoutMs: 5_000 });
const setup = snapora.setupElectronSnapora({
  ipcMain: null as unknown as IpcMain,
  managerOptions: { busyPolicy: 'reject' },
});
const result: Promise<snapora.ScreenshotResult> = manager.capture({
  locale: 'zh-CN',
});
const rendererApi = null as unknown as ScreenshotRendererApi;

void result;
void setup.preloadPath;
void setup.unregister;
void rendererApi.cancel;
