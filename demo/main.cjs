const { join } = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const {
  ScreenshotManager,
  registerScreenshotIpc,
  resolveHostPreloadPath,
} = require('electron-snapora/main');

const screenshotManager = new ScreenshotManager();
let unregisterScreenshotIpc;

function createHostWindow() {
  const hostWindow = new BrowserWindow({
    width: 760,
    height: 520,
    title: 'Electron Snapora Demo',
    webPreferences: {
      preload: resolveHostPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  hostWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Failed to load demo preload: ${preloadPath}`, error);
  });

  void hostWindow.loadFile(join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  unregisterScreenshotIpc = registerScreenshotIpc({
    ipcMain,
    manager: screenshotManager,
  });
  createHostWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createHostWindow();
    }
  });
});

app.on('before-quit', () => {
  unregisterScreenshotIpc?.();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
