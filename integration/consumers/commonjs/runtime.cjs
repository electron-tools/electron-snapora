const { existsSync } = require('node:fs');
const { app } = require('electron');
const {
  resolveHostPreloadPath,
  resolveOverlayResources,
} = require('electron-snapora/main');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const resources = [
    resolveHostPreloadPath(),
    ...Object.values(resolveOverlayResources()),
  ];
  if (!resources.every((path) => existsSync(path))) {
    throw new Error(
      `CommonJS consumer cannot resolve packaged resources: ${resources.join(', ')}`
    );
  }
  console.log('Electron Snapora CommonJS consumer passed.');
  app.quit();
});
