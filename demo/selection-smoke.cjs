process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(3);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(4);
});

const { app, clipboard } = require('electron');
const { ScreenshotManager } = require('electron-snapora/main');

const copyOutput = process.argv.includes('--copy');
const doubleClickOutput = process.argv.includes('--double-click');

app.disableHardwareAcceleration();

const smokeTimeout = setTimeout(() => {
  console.error('Electron Snapora selection smoke test timed out.');
  process.exit(2);
}, 20_000);

async function waitForReveal(window) {
  while (!window.isDestroyed() && window.getOpacity() < 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

app.on('browser-window-created', (_event, window) => {
  window.once('show', async () => {
    await waitForReveal(window);
    await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const waitUntilReady = () => {
          if (document.querySelector('.capture-surface')?.dataset.state === 'ready') {
            resolve();
            return;
          }
          requestAnimationFrame(waitUntilReady);
        };
        waitUntilReady();
      })
    `);
    const { width, height } = window.getContentBounds();
    const start = {
      x: Math.max(20, Math.round(width * 0.15)),
      y: Math.max(20, Math.round(height * 0.15)),
    };
    const end = {
      x: Math.max(start.x + 40, Math.round(width * 0.55)),
      y: Math.max(start.y + 40, Math.round(height * 0.5)),
    };

    window.webContents.sendInputEvent({
      type: 'mouseDown',
      ...start,
      button: 'left',
      clickCount: 1,
    });
    window.webContents.sendInputEvent({ type: 'mouseMove', ...end });
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      ...end,
      button: 'left',
      clickCount: 1,
    });

    const selectionState = await window.webContents.executeJavaScript(`
      new Promise((resolve) => requestAnimationFrame(() => {
        const selection = document.querySelector('.selection');
        resolve({
          phase: document.querySelector('.capture-surface')?.dataset.state,
          hidden: selection?.hidden,
          width: selection?.getBoundingClientRect().width,
          height: selection?.getBoundingClientRect().height,
        });
      }))
    `);
    if (
      selectionState.phase !== 'selected' ||
      selectionState.hidden ||
      selectionState.width <= 0 ||
      selectionState.height <= 0
    ) {
      throw new Error(`Selection was not created: ${JSON.stringify(selectionState)}`);
    }

    if (doubleClickOutput) {
      const center = {
        x: Math.round((start.x + end.x) / 2),
        y: Math.round((start.y + end.y) / 2),
      };
      for (const clickCount of [1, 2]) {
        window.webContents.sendInputEvent({
          type: 'mouseDown',
          ...center,
          button: 'left',
          clickCount,
        });
        window.webContents.sendInputEvent({
          type: 'mouseUp',
          ...center,
          button: 'left',
          clickCount,
        });
      }
      return;
    }

    const rectangleButton = await window.webContents.executeJavaScript(`
      (() => {
        const bounds = document.querySelector('[data-tool="rectangle"]')?.getBoundingClientRect();
        return bounds ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) } : null;
      })()
    `);
    if (!rectangleButton) {
      throw new Error('Rectangle tool was not rendered.');
    }
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      ...rectangleButton,
      button: 'left',
      clickCount: 1,
    });
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      ...rectangleButton,
      button: 'left',
      clickCount: 1,
    });

    const annotationStart = {
      x: start.x + Math.round((end.x - start.x) * 0.2),
      y: start.y + Math.round((end.y - start.y) * 0.2),
    };
    const annotationEnd = {
      x: start.x + Math.round((end.x - start.x) * 0.7),
      y: start.y + Math.round((end.y - start.y) * 0.65),
    };
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      ...annotationStart,
      button: 'left',
      clickCount: 1,
    });
    window.webContents.sendInputEvent({ type: 'mouseMove', ...annotationEnd });
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      ...annotationEnd,
      button: 'left',
      clickCount: 1,
    });

    const hasAnnotationPixels = await window.webContents.executeJavaScript(`
      new Promise((resolve) => requestAnimationFrame(() => {
        const canvas = document.querySelector('.annotation-canvas');
        const pixels = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        resolve(Boolean(pixels && pixels.some((value, index) => index % 4 === 3 && value > 0)));
      }))
    `);
    if (!hasAnnotationPixels) {
      throw new Error('Rectangle annotation was not rendered to the canvas.');
    }

    if (copyOutput) {
      const confirmButton = await window.webContents.executeJavaScript(`
        (() => {
          const bounds = document.querySelector('.confirm-button')?.getBoundingClientRect();
          return bounds ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) } : null;
        })()
      `);
      if (!confirmButton) {
        throw new Error('Copy-and-done button was not rendered.');
      }
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        ...confirmButton,
        button: 'left',
        clickCount: 1,
      });
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        ...confirmButton,
        button: 'left',
        clickCount: 1,
      });
    } else {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    }
  });
});

app.whenReady().then(async () => {
  const manager = new ScreenshotManager();
  const result = await manager.capture({ display: 'cursor' });
  clearTimeout(smokeTimeout);

  if (
    result.status !== 'completed' ||
    result.data.byteLength < 8 ||
    result.mimeType !== 'image/png' ||
    result.output.action !== 'copy' ||
    result.data[0] !== 0x89 ||
    result.data[1] !== 0x50
  ) {
    console.error('Electron Snapora selection smoke test failed:', result);
    process.exit(1);
    return;
  }

  if ((copyOutput || doubleClickOutput) && clipboard.readImage().isEmpty()) {
    console.error('Electron Snapora clipboard smoke test did not receive an image.');
    process.exit(1);
    return;
  }

  console.log(
    `Electron Snapora ${doubleClickOutput ? 'double-click' : copyOutput ? 'clipboard' : 'selection'} smoke test passed (${result.data.byteLength} bytes).`
  );
  process.exit(0);
});
