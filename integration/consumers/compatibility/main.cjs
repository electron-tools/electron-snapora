const { app } = require('electron');
const { ScreenshotManager } = require('electron-snapora/main');

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
  console.error('Electron Snapora compatibility smoke test timed out.');
  process.exit(2);
}, 20_000);

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const waitUntilReady = () => {
          if (document.querySelector('.capture-surface')?.dataset.state === 'ready') {
            resolve();
            return;
          }
          setTimeout(waitUntilReady, 10);
        };
        waitUntilReady();
      })
    `);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
});

app.whenReady().then(async () => {
  const expectedMajor = process.env.SNAPORA_EXPECTED_ELECTRON_MAJOR;
  if (process.versions.electron.split('.')[0] !== expectedMajor) {
    throw new Error(
      `Expected Electron ${expectedMajor}, received ${process.versions.electron}.`
    );
  }

  const manager = new ScreenshotManager();
  const result = await manager.capture({ display: 'cursor' });
  clearTimeout(smokeTimeout);
  if (result.status !== 'cancelled') {
    throw new Error(`Unexpected screenshot result: ${JSON.stringify(result)}`);
  }

  console.log(`Electron Snapora compatibility passed on ${process.versions.electron}.`);
  app.quit();
});
