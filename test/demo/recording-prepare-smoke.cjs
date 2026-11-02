/** Exercise the real demo entry without granting the recorder synthetic user activation. */
const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { OVERLAY_CHANNELS } = require('../../dist/main/index.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let selected = [];
ipcMain.on(OVERLAY_CHANNELS.selectionReady, (event, payload) => {
  selected.push({ win: BrowserWindow.fromWebContents(event.sender), ...payload });
});
require('../../demo/main.cjs');
async function wait(fn) {
  for (let i = 0; i < 300; i++) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error('Preparation test timed out');
}
const deadline = setTimeout(() => app.exit(1), 120000);
app.whenReady().then(async () => {
  try {
    const host = await wait(() =>
      BrowserWindow.getAllWindows().find(
        (w) => w.getTitle() === 'Electron Snapora Demo'
      )
    );
    await wait(() =>
      host.webContents.executeJavaScript(
        'document.querySelector(".capture-button")?.disabled === false'
      )
    );
    for (const display of screen.getAllDisplays()) {
      for (const selection of [
        { x: 50, y: 100, width: 600, height: 300 },
        {
          x: 31,
          y: 75,
          width: Math.min(1103, display.bounds.width - 31),
          height: Math.min(713, display.bounds.height - 75),
        },
        { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height },
      ]) {
        selected = [];
        await host.webContents.executeJavaScript(
          'document.querySelector(".capture-button").click()',
          true
        );
        const overlay = await wait(() =>
          selected.find((s) => {
            const bounds = s.win.getBounds();
            return bounds.x === display.bounds.x && bounds.y === display.bounds.y;
          })
        );
        await overlay.win.webContents.executeJavaScript(
          'document.querySelector("[data-mode=record]").click()',
          true
        );
        await overlay.win.webContents.executeJavaScript(
          `window.snaporaOverlay.selected(${JSON.stringify({ jobId: overlay.jobId, displayId: String(display.id), selection })})`,
          true
        );
        const recorder = await wait(() =>
          BrowserWindow.getAllWindows().find((w) =>
            w.webContents.getURL().includes('recording.html')
          )
        );
        const state = await wait(() =>
          recorder.webContents.executeJavaScript(`(() => {
          const start = document.getElementById('start');
          if (!start || start.getAttribute('aria-busy') !== 'false') return;
          return { text: start.textContent, error: document.getElementById('prepare-error-text').textContent, errorHidden: document.getElementById('prepare-error').hidden };
        })()`)
        );
        console.log('PREPARE_RESULT', { display: display.id, selection, state });
        assert.equal(state.errorHidden, true, 'real demo preparation must succeed');
        assert.equal(state.text, '开始录制');
        await recorder.webContents.executeJavaScript(
          'void window.snaporaRecording.request("cancel")'
        );
        await wait(() =>
          host.webContents.executeJavaScript(
            '!document.querySelector(".record-button").disabled'
          )
        );
      }
    }
    console.log('RECORDING_PREPARE_SMOKE_OK');
    clearTimeout(deadline);
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
