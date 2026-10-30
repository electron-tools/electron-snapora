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

// Public provider and permission types must survive the CommonJS declaration build.
const macProvider = snapora.createMacSnapProvider({ granularity: 'panel' });
const permissions: Promise<snapora.MacSnapPermissions> = macProvider.getPermissions();
const withSnapping = new snapora.ScreenshotManager({
  getWindowSnapRegions: macProvider,
});
const diagnostic: snapora.MacSnapDiagnostic = {
  durationMs: 0,
  windows: 1,
  containers: 0,
  accessibility: false,
};
void permissions;
void diagnostic;
withSnapping.dispose();
macProvider.dispose();
