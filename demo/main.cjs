const { join } = require('node:path');
const { release } = require('node:os');
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const {
  ScreenshotManager,
  registerScreenshotIpc,
  createWindowsSnapProvider,
  createMacSnapProvider,
} = require('electron-snapora/main');

let snapGranularity = 'window';
const liveSupported =
  process.platform === 'win32' ||
  (process.platform === 'darwin' && Number(release().split('.')[0]) >= 23);
let interactionMode = liveSupported ? 'live' : 'frozen';
const snapProvider =
  process.platform === 'win32'
    ? createWindowsSnapProvider({
        keepAlive: true,
        onDiagnostic: (event) => console.log('[Windows container snap]', event),
      })
    : process.platform === 'darwin' && liveSupported
      ? createMacSnapProvider({
          onDiagnostic: (event) => console.log('[macOS container snap]', event),
        })
      : undefined;
const screenshotManager = new ScreenshotManager({
  ...(snapProvider
    ? {
        getWindowSnapRegions: (signal, onUpdate, context) =>
          snapProvider(signal, onUpdate, snapGranularity, context),
      }
    : {}),
});
let unregisterScreenshotIpc;
const hostWindows = new Set();
let isMacScreenshotInProgress = false;

async function triggerDemoScreenshot() {
  if (process.platform !== 'darwin') {
    return screenshotManager.capture({
      display: interactionMode === 'live' ? 'all' : 'cursor',
      interactionMode,
      showCopyFeedback: true,
    });
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
    return await screenshotManager.capture({
      display: interactionMode === 'live' ? 'all' : 'cursor',
      interactionMode,
      showCopyFeedback: true,
    });
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

// Avoid Lark/Ping's Ctrl+Shift+A while testing cross-application capture.
const DEFAULT_SHORTCUT =
  process.platform === 'win32' ? 'Control+Alt+Shift+S' : 'CommandOrControl+Shift+A';
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
  hostWindow.once('closed', () => {
    hostWindows.delete(hostWindow);
    // Prewarmed hidden selection windows must not keep a closed demo alive.
    if (hostWindows.size === 0 && process.platform !== 'darwin') app.quit();
  });

  hostWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Failed to load demo preload: ${preloadPath}`, error);
  });

  void hostWindow.loadFile(join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  void snapProvider?.prepare().catch((error) => console.warn('[Snap warmup]', error));
  if (liveSupported)
    void screenshotManager
      .prepare({ display: 'all', interactionMode: 'live' })
      .catch((error) => console.warn('[Live selection warmup]', error));
  unregisterScreenshotIpc = registerScreenshotIpc({
    ipcMain,
    manager: screenshotManager,
  });

  // Register handlers to read and update the global shortcut.
  ipcMain.handle('demo:get-shortcut', () => currentShortcut);
  const validateSnapSender = (event) => {
    const host = BrowserWindow.fromWebContents(event.sender);
    if (!hostWindows.has(host) || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Only the demo main frame can change capture settings.');
    }
  };
  ipcMain.handle('demo:get-snap-granularity', (event) => {
    validateSnapSender(event);
    return { supported: Boolean(snapProvider), granularity: snapGranularity };
  });
  ipcMain.handle('demo:get-interaction', (event) => {
    validateSnapSender(event);
    return { supported: liveSupported, mode: interactionMode };
  });
  ipcMain.handle('demo:set-interaction', (event, mode) => {
    validateSnapSender(event);
    if (!['live', 'frozen'].includes(mode) || (mode === 'live' && !liveSupported))
      throw new Error('Unsupported interaction mode.');
    if (screenshotManager.activeJobId)
      throw new Error('Wait for the current capture to finish.');
    interactionMode = mode;
    return mode;
  });
  ipcMain.handle('demo:set-snap-granularity', (event, value) => {
    validateSnapSender(event);
    if (!snapProvider || !['window', 'panel', 'fine'].includes(value)) {
      throw new Error('Unsupported snap granularity.');
    }
    if (screenshotManager.activeJobId)
      throw new Error('Wait for the current capture to finish.');
    snapGranularity = value;
    return snapGranularity;
  });
  ipcMain.handle('demo:set-shortcut', (_event, accelerator) =>
    registerCurrentShortcut(accelerator)
  );
  ipcMain.handle('demo:mac-permissions', async (event, prompt) => {
    validateSnapSender(event);
    if (typeof prompt !== 'boolean') throw new Error('Invalid permission request.');
    if (process.platform !== 'darwin' || !snapProvider?.getPermissions)
      return { supported: false };
    if (screenshotManager.activeJobId)
      throw new Error('Wait for the current capture to finish.');
    return { supported: true, ...(await snapProvider.getPermissions(prompt)) };
  });

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
    if (hostWindows.size === 0) {
      createHostWindow();
    }
  });
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  unregisterScreenshotIpc?.();
  screenshotManager.dispose();
  snapProvider?.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
