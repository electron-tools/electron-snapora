process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(3);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(4);
});

const { app, BrowserWindow, clipboard, screen } = require('electron');
const { ScreenshotManager } = require('electron-snapora/main');

const copyOutput = process.argv.includes('--copy');
const doubleClickOutput = process.argv.includes('--double-click');
const pinOutput = process.argv.includes('--pin');
let captureWindow;

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
  if (captureWindow) {
    return;
  }
  captureWindow = window;
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
    const displayBounds = screen.getDisplayMatching(window.getBounds()).bounds;
    const rendererGeometry = await window.webContents.executeJavaScript(`
      (() => {
        const frame = document.querySelector('.screen-frame')?.getBoundingClientRect();
        return {
          innerWidth,
          innerHeight,
          frameWidth: frame?.width,
          frameHeight: frame?.height,
          devicePixelRatio,
        };
      })()
    `);
    if (
      width !== displayBounds.width ||
      height !== displayBounds.height ||
      rendererGeometry.innerWidth !== width ||
      rendererGeometry.innerHeight !== height ||
      rendererGeometry.frameWidth !== width ||
      rendererGeometry.frameHeight !== height
    ) {
      throw new Error(
        `Capture geometry does not match the display: ${JSON.stringify({ width, height, displayBounds, rendererGeometry })}`
      );
    }
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

    if (copyOutput || pinOutput) {
      const outputButton = await window.webContents.executeJavaScript(`
        (() => {
          const bounds = document.querySelector('${pinOutput ? '.pin-button' : '.confirm-button'}')?.getBoundingClientRect();
          return bounds ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) } : null;
        })()
      `);
      if (!outputButton) {
        throw new Error('Requested output button was not rendered.');
      }
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        ...outputButton,
        button: 'left',
        clickCount: 1,
      });
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        ...outputButton,
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
    result.output.action !== (pinOutput ? 'pin' : 'copy') ||
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

  if (doubleClickOutput) {
    const feedbackWindow = await waitForCopyFeedbackWindow();
    if (!feedbackWindow || feedbackWindow.isDestroyed()) {
      console.error('Electron Snapora copy feedback window closed too early.');
      process.exit(1);
      return;
    }
    const feedbackState = await feedbackWindow.webContents.executeJavaScript(`
      (() => {
        const feedback = document.querySelector('.copy-feedback');
        const feedbackStyle = getComputedStyle(feedback);
        const feedbackBounds = feedback.getBoundingClientRect();
        const iconStyle = getComputedStyle(document.querySelector('.copy-feedback-icon'));
        const checkStyle = getComputedStyle(document.querySelector('.copy-feedback-check'));
        return {
          text: feedback.textContent?.trim(),
          height: feedbackBounds.height,
          borderColor: feedbackStyle.borderTopColor,
          whiteSpace: feedbackStyle.whiteSpace,
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          screenDisplay: getComputedStyle(document.querySelector('.screen-frame')).display,
          statusDisplay: getComputedStyle(document.querySelector('.status')).display,
          iconBackground: iconStyle.backgroundColor,
          checkFill: checkStyle.fill,
          checkStroke: checkStyle.stroke,
        };
      })()
    `);
    const feedbackBounds = feedbackWindow.getContentBounds();
    if (
      !feedbackState.text.includes('clipboard') ||
      feedbackState.height > 50 ||
      feedbackState.borderColor !== 'rgb(246, 189, 70)' ||
      feedbackState.whiteSpace !== 'nowrap' ||
      feedbackState.bodyBackground !== 'rgba(0, 0, 0, 0)' ||
      feedbackState.screenDisplay !== 'none' ||
      feedbackState.statusDisplay !== 'none' ||
      feedbackState.iconBackground !== 'rgba(0, 0, 0, 0)' ||
      feedbackState.checkFill !== 'rgb(246, 189, 70)' ||
      feedbackState.checkStroke !== 'none' ||
      feedbackBounds.width > 360 ||
      feedbackBounds.height > 72
    ) {
      console.error('Electron Snapora copy feedback was not isolated:', feedbackState);
      process.exit(1);
      return;
    }
  }

  if (pinOutput) {
    const pinnedWindow = await waitForPinnedWindow();
    if (!pinnedWindow) {
      console.error('Electron Snapora pin output did not create a pinned window.');
      process.exit(1);
      return;
    }
    const pinnedState = await pinnedWindow.webContents.executeJavaScript(`({
      image: document.querySelector('.pinned-image')?.src.startsWith('blob:'),
      closeButton: Boolean(document.querySelector('.pinned-close'))
    })`);
    if (!pinnedState.image || !pinnedState.closeButton) {
      console.error('Electron Snapora pinned window did not initialize:', pinnedState);
      process.exit(1);
      return;
    }
  }

  console.log(
    `Electron Snapora ${pinOutput ? 'pin' : doubleClickOutput ? 'double-click' : copyOutput ? 'clipboard' : 'selection'} smoke test passed (${result.data.byteLength} bytes).`
  );
  process.exit(0);
});

async function waitForCopyFeedbackWindow() {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window === captureWindow) {
        continue;
      }
      const isFeedback = await window.webContents.executeJavaScript(
        `document.documentElement.dataset.snaporaFeedback === 'copy'`
      );
      if (isFeedback) {
        return window;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}

async function waitForPinnedWindow() {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window === captureWindow) {
        continue;
      }
      const isPinned = await window.webContents.executeJavaScript(
        `Boolean(document.querySelector('.pinned-surface'))`
      );
      if (isPinned) {
        return window;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}
