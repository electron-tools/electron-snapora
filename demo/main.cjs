const { join } = require('node:path');
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const {
  ScreenshotManager,
  registerScreenshotIpc,
} = require('electron-snapora/main');

const screenshotManager = new ScreenshotManager();
let unregisterScreenshotIpc;

// 默认快捷键为 CommandOrControl+Shift+A（Windows/Linux: Ctrl+Shift+A, Mac: Cmd+Shift+A）
const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+A';
let currentShortcut = DEFAULT_SHORTCUT;

/** 注册全局截图快捷键 */
function registerCurrentShortcut(accelerator) {
  // 先注销旧快捷键
  if (currentShortcut) {
    try {
      globalShortcut.unregister(currentShortcut);
    } catch {
      // 忽略注销失败
    }
  }

  const target = (accelerator || '').trim();
  currentShortcut = target || DEFAULT_SHORTCUT;
  if (!target) {
    return { success: true, shortcut: '' };
  }

  try {
    const success = globalShortcut.register(target, () => {
      console.log(`[Demo] Triggering screenshot via global shortcut: ${target}`);
      void screenshotManager.capture({ display: 'cursor' });
    });

    if (!success) {
      return {
        success: false,
        shortcut: currentShortcut,
        error: `快捷键 "${target}" 注册失败，可能已被系统或其他软件占用。`,
      };
    }

    return { success: true, shortcut: target };
  } catch (error) {
    return {
      success: false,
      shortcut: currentShortcut,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createHostWindow() {
  const hostWindow = new BrowserWindow({
    width: 800,
    height: 640,
    title: 'Electron Snapora Demo',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
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

  // 注册全局快捷键查询与动态修改接口
  ipcMain.handle('demo:get-shortcut', () => currentShortcut);
  ipcMain.handle('demo:set-shortcut', (_event, accelerator) =>
    registerCurrentShortcut(accelerator)
  );

  // 默认启动时立即生效注册快捷键
  registerCurrentShortcut(DEFAULT_SHORTCUT);

  createHostWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createHostWindow();
    }
  });
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  unregisterScreenshotIpc?.();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

