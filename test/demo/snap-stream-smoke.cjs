/** Real Overlay regression for delayed candidates, stale jobs and pointer-down selection stability. */
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { ScreenshotManager, OVERLAY_CHANNELS } = require('electron-snapora/main');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-stream-smoke-')));
let manager;
let publish;
let outer;
let inner;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = setTimeout(() => {
  manager?.dispose();
  app.exit(1);
}, 15_000);

async function rect(window, selector) {
  return window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const r = element.getBoundingClientRect();
    return { hidden: element.hidden, x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
}

ipcMain.once(OVERLAY_CHANNELS.prepared, (event, payload) => {
  void (async () => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const display = screen.getPrimaryDisplay();
    const x = inner.x - display.bounds.x + 50;
    const y = inner.y - display.bounds.y + 50;
    await pause(50);
    // Ensure a real pointer transition even when Chromium retained the same cursor location.
    window.webContents.sendInputEvent({ type: 'mouseMove', x: x + 10, y: y + 10 });
    await pause(30);
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await pause(50);
    assert.equal((await rect(window, '.window-snap-preview')).width, outer.width);
    // No pointer movement: streaming must refresh an existing hover preview.
    publish([outer, inner]);
    await pause(50);
    const preview = await rect(window, '.window-snap-preview');
    assert.equal(preview.width, inner.width);
    assert.equal(preview.hidden, false);
    window.webContents.send(OVERLAY_CHANNELS.snapRegions, {
      ...payload,
      jobId: 'old-job',
      regions: [],
    });
    await pause(30);
    assert.deepEqual(await rect(window, '.window-snap-preview'), preview);
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x,
      y,
    });
    await pause(30);
    publish([outer]);
    await pause(30);
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x,
      y,
    });
    await pause(50);
    const selected = await rect(window, '.selection');
    assert.deepEqual(selected, preview);
    publish([]);
    await pause(30);
    assert.deepEqual(await rect(window, '.selection'), selected);
    console.log(
      JSON.stringify({
        idleHoverRefined: true,
        staleJobIgnored: true,
        pointerDownFrozen: true,
        selectionPreserved: true,
      })
    );
    manager.cancel();
  })().catch((error) => {
    console.error(error);
    manager?.dispose();
    app.exit(1);
  });
});

app
  .whenReady()
  .then(async () => {
    const { bounds } = screen.getPrimaryDisplay();
    outer = {
      x: bounds.x + 100,
      y: bounds.y + 100,
      width: 600,
      height: 400,
      kind: 'window',
      windowZOrder: 0,
    };
    inner = {
      ...outer,
      x: outer.x + 50,
      y: outer.y + 50,
      width: 300,
      height: 200,
      kind: 'container',
    };
    manager = new ScreenshotManager({
      getWindowSnapRegions: (signal, update) => {
        publish = update;
        update([outer]);
        return new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve([]), { once: true })
        );
      },
    });
    const result = await manager.capture({ display: 'primary' });
    assert.equal(result.status, 'cancelled');
    manager.dispose();
    clearTimeout(deadline);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    manager?.dispose();
    app.exit(1);
  });
