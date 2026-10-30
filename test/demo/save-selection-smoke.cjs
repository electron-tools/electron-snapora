/** 用合成图片和延迟的保存响应验证真实 renderer；窗口始终隐藏，不采集桌面或打开系统对话框。 */
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const {
  ElectronOutputAdapter,
  OVERLAY_CHANNELS,
  SCREENSHOT_PROTOCOL_VERSION,
} = require('electron-snapora/main');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-save-selection-')));
app.on('window-all-closed', () => {});
let overlay;
let releaseSave;
let outputCount = 0;
let completed;
let rendererError;
const deadline = setTimeout(() => {
  console.error('Save selection regression timed out');
  app.exit(1);
}, 15000);
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
const evaluate = (code) => overlay.webContents.executeJavaScript(code);
async function waitFor(predicate) {
  for (let i = 0; i < 250; i++) {
    if (rendererError) throw new Error(JSON.stringify(rendererError));
    if (await predicate()) return;
    await pause();
  }
  throw new Error('Save selection state did not settle');
}

app.whenReady().then(async () => {
  try {
    const adapter = new ElectronOutputAdapter({
      saveFile: () =>
        new Promise((resolve) => {
          releaseSave = resolve;
        }),
    });
    ipcMain.handle(OVERLAY_CHANNELS.output, (event, payload) => {
      outputCount++;
      return adapter.execute(payload, { senderWebContentsId: event.sender.id });
    });
    ipcMain.on(OVERLAY_CHANNELS.confirm, (_event, payload) => {
      completed = payload;
    });
    ipcMain.on(OVERLAY_CHANNELS.error, (_event, payload) => {
      rendererError = payload;
    });
    let ready = false;
    ipcMain.on(OVERLAY_CHANNELS.ready, () => {
      ready = true;
    });
    overlay = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../../dist/overlay/preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    await overlay.loadFile(join(__dirname, '../../dist/overlay/index.html'));
    await waitFor(() => ready);
    const selection = { x: 100, y: 100, width: 320, height: 220 };
    overlay.webContents.send(OVERLAY_CHANNELS.initialize, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'save-selection',
      options: {},
      initialSelection: selection,
      frames: [
        {
          display: {
            id: 'synthetic',
            bounds: { x: 0, y: 0, width: 800, height: 600 },
            scaleFactor: 1,
          },
          pixelSize: { width: 800, height: 600 },
          dataUrl: nativeImage
            .createFromBitmap(Buffer.alloc(800 * 600 * 4, 255), {
              width: 800,
              height: 600,
            })
            .toDataURL(),
        },
      ],
    });
    await waitFor(() =>
      evaluate(
        `document.querySelector('.capture-surface').dataset.state === 'selected'`
      )
    );
    const snapshot = () =>
      evaluate(`(() => {
      const selection = document.querySelector('.selection'), toolbar = document.querySelector('.selection-toolbar');
      const style = getComputedStyle(selection);
      return { phase: document.querySelector('.capture-surface').dataset.state,
        visible: !selection.hidden && style.display !== 'none' && style.visibility !== 'hidden',
        bounds: [selection.style.left, selection.style.top, selection.style.width, selection.style.height],
        mask: style.boxShadow, toolbarVisible: !toolbar.hidden, locked: toolbar.inert };
    })()`);
    const before = await snapshot();
    assert.equal(before.visible, true);
    assert.notEqual(before.mask, 'none');
    for (const result of [undefined, 'synthetic-result.png']) {
      releaseSave = undefined;
      await evaluate(`document.querySelector('.save-button').click()`);
      await waitFor(() => Boolean(releaseSave));
      const pending = await snapshot();
      assert.deepEqual(pending, { ...before, phase: 'exporting', locked: true });
      const count = outputCount;
      await evaluate(`document.querySelector('.save-button').click()`);
      assert.equal(outputCount, count, 'A pending save must not open another dialog');
      assert.equal(
        completed,
        undefined,
        'Keep the screenshot active until saving succeeds'
      );
      releaseSave(result);
      if (result === undefined) {
        await waitFor(() =>
          evaluate(
            `document.querySelector('.capture-surface').dataset.state === 'selected'`
          )
        );
        assert.deepEqual(
          await snapshot(),
          before,
          'Cancel restores editing without changing the selection'
        );
      }
    }
    await waitFor(() => Boolean(completed));
    assert.deepEqual(completed.result.output, {
      action: 'save',
      filePath: 'synthetic-result.png',
    });
    assert.equal(
      (await snapshot()).visible,
      false,
      'Clear selection only after successful output'
    );
    assert.equal(overlay.isVisible(), false);
    console.log(
      'PASS: selection/mask/toolbar stay visible during save; duplicate output blocked; cancel restores editing; success cleans up. No desktop capture.'
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    overlay?.destroy();
    app.exit(process.exitCode || 0);
  }
});
