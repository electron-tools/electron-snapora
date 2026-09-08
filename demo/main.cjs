const { join } = require('node:path');
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const { ScreenshotManager, registerScreenshotIpc } = require('electron-snapora/main');

const screenshotManager = new ScreenshotManager();
let unregisterScreenshotIpc;

// 默认快捷键为 CommandOrControl+Shift+A（Windows/Linux: Ctrl+Shift+A, Mac: Cmd+Shift+A）
const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+A';
let currentShortcut = DEFAULT_SHORTCUT;

/** 注册全局截图快捷键 */
function registerCurrentShortcut(accelerator) {
  // 1. 安全注销旧快捷键，加装 try...catch 彻底防范旧快捷键格式非法导致的抛错死锁
  if (currentShortcut) {
    try {
      globalShortcut.unregister(currentShortcut);
    } catch (unregisterError) {
      console.warn('[Demo] 忽略旧快捷键注销异常，避免死锁:', unregisterError);
    }
  }

  const target = (accelerator || '').trim();
  currentShortcut = target || DEFAULT_SHORTCUT;
  if (!target) {
    return { success: true, shortcut: '' };
  }

  // 2. 非 ASCII 字符拦截防御（防止如 Alt+Å、Alt+≈ 等特殊字符直接打入底层导致 C++ 抛出 conversion failure 异常）
  if (/[\u0080-\uFFFF]/.test(target)) {
    return {
      success: false,
      shortcut: currentShortcut,
      error: `快捷键 "${target}" 包含非法或非 ASCII 字符（如 macOS 变音符），请使用标准英文字母或数字。`,
    };
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

  // 启动自愈检测：防止持久化或旧变量残存非 ASCII 污染
  if (/[\u0080-\uFFFF]/.test(currentShortcut)) {
    console.warn(
      `[Demo] 检测到非法快捷键配置 "${currentShortcut}"，自动自愈重置为默认值。`
    );
    currentShortcut = DEFAULT_SHORTCUT;
  }
  // 默认启动时立即生效注册快捷键
  registerCurrentShortcut(currentShortcut);

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
