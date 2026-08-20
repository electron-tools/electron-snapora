const { existsSync } = require('node:fs');
const { app, ipcMain } = require('electron');
const {
  resolveOverlayResources,
  setupElectronSnapora,
} = require('electron-snapora/main');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const snapora = setupElectronSnapora({ ipcMain });
  const resources = [snapora.preloadPath, ...Object.values(resolveOverlayResources())];
  if (!resources.every((path) => existsSync(path))) {
    throw new Error(
      `CommonJS consumer cannot resolve packaged resources: ${resources.join(', ')}`
    );
  }
  snapora.unregister();
  console.log('Electron Snapora CommonJS consumer passed.');
  app.quit();
});
