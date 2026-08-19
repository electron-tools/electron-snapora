const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');
const { resolveHostPreloadPath } = require('electron-snapora/main');

process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(3);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(4);
});

app.disableHardwareAcceleration();

const smokeTimeout = setTimeout(() => {
  console.error('Electron Snapora host preload smoke test timed out.');
  process.exit(2);
}, 10_000);

app.whenReady().then(async () => {
  const hostWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: resolveHostPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  await hostWindow.loadFile(join(__dirname, 'index.html'));
  const hasScreenshotApi = await hostWindow.webContents.executeJavaScript(
    "typeof window.electronSnapora?.capture === 'function'"
  );
  clearTimeout(smokeTimeout);
  hostWindow.destroy();

  if (!hasScreenshotApi) {
    console.error('Electron Snapora host preload smoke test failed.');
    process.exit(1);
    return;
  }

  console.log('Electron Snapora host preload smoke test passed.');
  process.exit(0);
});
