const { writeFileSync } = require('node:fs');
const { app, BrowserWindow } = require('electron');
const {
  resolveHostPreloadPath,
  resolveOverlayResources,
} = require('electron-snapora/main');

app.disableHardwareAcceleration();

function writeResult(result) {
  const outputPath = process.env.SNAPORA_VERIFY_OUTPUT;
  if (!outputPath) {
    throw new Error('SNAPORA_VERIFY_OUTPUT is required.');
  }
  writeFileSync(outputPath, JSON.stringify(result));
}

async function verifyPackagedResources() {
  const hostWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: resolveHostPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await hostWindow.loadURL('data:text/html,<html><body>host</body></html>');
  const hostApiReady = await hostWindow.webContents.executeJavaScript(
    "typeof window.electronSnapora?.capture === 'function' && typeof window.electronSnapora?.cancel === 'function'"
  );

  const resources = resolveOverlayResources();
  const overlayWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: resources.preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await overlayWindow.loadFile(resources.htmlPath);
  const overlayState = await overlayWindow.webContents.executeJavaScript(`
    ({
      apiReady: typeof window.snaporaOverlay?.ready === 'function',
      surfaceReady: Boolean(document.querySelector('.capture-surface')),
      cssReady: getComputedStyle(document.querySelector('.capture-surface')).position === 'relative'
    })
  `);

  hostWindow.destroy();
  overlayWindow.destroy();
  if (!hostApiReady || !Object.values(overlayState).every(Boolean)) {
    throw new Error(
      `Packaged resources are incomplete: ${JSON.stringify({ hostApiReady, overlayState })}`
    );
  }
}

app
  .whenReady()
  .then(verifyPackagedResources)
  .then(() => writeResult({ status: 'passed' }))
  .catch((error) => {
    writeResult({
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(() => app.quit());
