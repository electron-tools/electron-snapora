import { existsSync } from 'node:fs';
import { app } from 'electron';
import { resolveHostPreloadPath, resolveOverlayResources } from 'electron-snapora/main';

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const resources = [
    resolveHostPreloadPath(),
    ...Object.values(resolveOverlayResources()),
  ];
  if (!resources.every((path) => existsSync(path))) {
    throw new Error(
      `ESM consumer cannot resolve packaged resources: ${resources.join(', ')}`
    );
  }
  console.log('Electron Snapora ESM consumer passed.');
  app.quit();
});
