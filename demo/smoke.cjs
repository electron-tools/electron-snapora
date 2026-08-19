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
    const presentation = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const waitUntilReady = () => {
          if (document.querySelector('.capture-surface')?.dataset.state === 'ready') {
            const root = document.documentElement;
            resolve({
              locale: root.lang,
              mode: root.dataset.snaporaTheme,
              accent: getComputedStyle(root).getPropertyValue('--snapora-color-accent').trim(),
              confirm: document.querySelector('.confirm-button')?.dataset.tooltip,
              selection: document.querySelector('.selection')?.getAttribute('aria-label'),
            });
            return;
          }
          setTimeout(waitUntilReady, 10);
        };
        waitUntilReady();
      })
    `);
    if (
      presentation.locale !== 'zh-CN' ||
      presentation.mode !== 'light' ||
      presentation.accent !== '#6750a4' ||
      presentation.confirm !== '复制到聊天框' ||
      presentation.selection !== '截图选区'
    ) {
      throw new Error(`Overlay presentation mismatch: ${JSON.stringify(presentation)}`);
    }
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 2_000;
      const waitUntilVisible = () => {
        if (window.isDestroyed()) {
          reject(new Error('Overlay closed before becoming visible.'));
          return;
        }
        if (window.getOpacity() === 1) {
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error('Overlay did not become visible in time.'));
          return;
        }
        setTimeout(waitUntilVisible, 10);
      };
      waitUntilVisible();
    });
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
});

app.whenReady().then(async () => {
  const diagnostics = [];
  const manager = new ScreenshotManager({
    onDiagnostic: (event) => diagnostics.push(event),
  });
  const result = await manager.capture({
    display: 'cursor',
    locale: 'zh-CN',
    messages: { confirm: '复制到聊天框' },
    theme: {
      mode: 'light',
      accentColor: '#6750a4',
      accentForegroundColor: '#ffffff',
    },
  });
  clearTimeout(smokeTimeout);

  if (result.status !== 'cancelled') {
    console.error('Electron Snapora smoke test failed:', result);
    process.exit(1);
    return;
  }

  const diagnosticStages = new Set(
    diagnostics.map((event) => `${event.stage}:${event.phase}`)
  );
  for (const expected of [
    'session:start',
    'capture:complete',
    'overlay-create:complete',
    'overlay-load:complete',
    'overlay-ready:complete',
    'overlay-prepare:complete',
    'session:cancel',
  ]) {
    if (!diagnosticStages.has(expected)) {
      console.error('Electron Snapora diagnostic smoke test failed:', diagnostics);
      process.exit(1);
      return;
    }
  }

  console.log('Electron Snapora smoke test passed.');
  process.exit(0);
});
