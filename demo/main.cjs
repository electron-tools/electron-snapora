const { join } = require('node:path');
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const { ScreenshotManager, registerScreenshotIpc } = require('electron-snapora/main');

const screenshotManager = new ScreenshotManager();
let unregisterScreenshotIpc;
const hostWindows = new Set();
let isMacScreenshotInProgress = false;

async function triggerDemoScreenshot() {
  if (process.platform !== 'darwin') {
    return screenshotManager.capture({ display: 'cursor' });
  }
  if (isMacScreenshotInProgress || screenshotManager.activeJobId) return;
  isMacScreenshotInProgress = true;
  const windowsToRestore = [];
  let previous = null;
  try {
    if (!app.isActive()) {
      const { getFrontmostProcess } = require('./mac-window-focus.cjs');
      previous = getFrontmostProcess();
      // Temporarily disable focus only for registered host windows.
      for (const win of hostWindows) {
        if (!win.isDestroyed() && win.isFocusable()) {
          try {
            win.setFocusable(false);
            windowsToRestore.push(win);
          } catch {
            // Skip windows being destroyed.
          }
        }
      }
    }
    return await screenshotManager.capture({ display: 'cursor' });
  } finally {
    try {
      if (previous && previous.pid !== process.pid) {
        const { restoreFrontmostProcess } = require('./mac-window-focus.cjs');
        await restoreFrontmostProcess(previous);
      }
    } finally {
      for (const win of windowsToRestore) {
        if (!win.isDestroyed()) {
          try {
            win.setFocusable(true);
          } catch {
            // Skip windows being destroyed.
          }
        }
      }
      isMacScreenshotInProgress = false;
    }
  }
}

// Use Cmd+Shift+A on macOS and Ctrl+Shift+A on Windows and Linux.
const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+A';
let currentShortcut = DEFAULT_SHORTCUT;

/** Register the global capture shortcut. */
function registerCurrentShortcut(accelerator) {
  // Unregister the previous shortcut before registering its replacement.
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

  // Reject non-ASCII accelerator names before calling the native API.
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
      void triggerDemoScreenshot().catch((error) => {
        console.error('[Demo] Screenshot failed:', error);
      });
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

  hostWindows.add(hostWindow);
  hostWindow.once('closed', () => hostWindows.delete(hostWindow));

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

  // Register handlers to read and update the global shortcut.
  ipcMain.handle('demo:get-shortcut', () => currentShortcut);
  ipcMain.handle('demo:set-shortcut', (_event, accelerator) =>
    registerCurrentShortcut(accelerator)
  );

  // Reset invalid non-ASCII shortcut values before registration.
  if (/[\u0080-\uFFFF]/.test(currentShortcut)) {
    console.warn(
      `[Demo] 检测到非法快捷键配置 "${currentShortcut}"，自动自愈重置为默认值。`
    );
    currentShortcut = DEFAULT_SHORTCUT;
  }
  // Register the current shortcut during startup.
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
