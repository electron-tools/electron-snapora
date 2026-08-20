import { existsSync } from 'node:fs';
import { app, ipcMain } from 'electron';
import { resolveOverlayResources, setupElectronSnapora } from 'electron-snapora/main';

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const snapora = setupElectronSnapora({ ipcMain });
  const resources = [snapora.preloadPath, ...Object.values(resolveOverlayResources())];
  if (!resources.every((path) => existsSync(path))) {
    throw new Error(
      `ESM consumer cannot resolve packaged resources: ${resources.join(', ')}`
    );
  }
  snapora.unregister();
  console.log('Electron Snapora ESM consumer passed.');
  app.quit();
});
