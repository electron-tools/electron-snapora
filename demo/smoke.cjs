process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(3);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(4);
});

const { app } = require('electron');
const { ScreenshotManager } = require('electron-snapora/main');

app.disableHardwareAcceleration();

const smokeTimeout = setTimeout(() => {
  console.error('Electron Snapora smoke test timed out.');
  process.exit(2);
}, 15_000);

app.on('browser-window-created', (_event, window) => {
  // 等待透明预热之后的 Renderer 初始化完成，避免把预热 show 事件误当成可交互状态。
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
  const manager = new ScreenshotManager();
  const result = await manager.capture({ display: 'cursor' });
  clearTimeout(smokeTimeout);

  if (result.status !== 'cancelled') {
    console.error('Electron Snapora smoke test failed:', result);
    process.exit(1);
    return;
  }

  console.log('Electron Snapora smoke test passed.');
  process.exit(0);
});
