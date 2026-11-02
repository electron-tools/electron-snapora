/** Verify real multi-display menu synchronization, horizontal drag and screenshot handoff. */
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
const { ScreenshotManager, OVERLAY_CHANNELS } = require('../../dist/main/index.cjs');
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let manager;
const deadline = setTimeout(() => {
  manager?.dispose();
  app.exit(1);
}, 30000);
async function wait(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error('Menu test timed out');
}
app.whenReady().then(async () => {
  try {
    const windows = [];
    ipcMain.on(OVERLAY_CHANNELS.selectionReady, (event) =>
      windows.push(BrowserWindow.fromWebContents(event.sender))
    );
    manager = new ScreenshotManager();
    const result = manager.capture({ locale: 'zh-CN' });
    const { screen } = require('electron');
    await wait(() => windows.length === screen.getAllDisplays().length);
    const first = windows[0];
    const js = (code) => first.webContents.executeJavaScript(code);
    const menuBounds = await js(`(() => {
      const r = document.querySelector('.capture-mode-menu').getBoundingClientRect();
      return { x: Math.floor(r.x)-8, y: Math.floor(r.y)-8, width: Math.ceil(r.width)+16, height: Math.ceil(r.height)+16 };
    })()`);
    const imagePath = join(mkdtempSync(join(tmpdir(), 'snapora-menu-ui-')), 'menu.png');
    writeFileSync(imagePath, (await first.webContents.capturePage(menuBounds)).toPNG());
    console.log('CAPTURE_MENU_IMAGE', imagePath);
    const rect = await js(
      '(()=>{const r=document.querySelector(".capture-menu-grip").getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+10),left:document.querySelector(".capture-mode-menu").offsetLeft,top:document.querySelector(".capture-mode-menu").offsetTop}})()'
    );
    first.webContents.sendInputEvent({
      type: 'mouseDown',
      x: rect.x,
      y: rect.y,
      button: 'left',
      clickCount: 1,
    });
    first.webContents.sendInputEvent({
      type: 'mouseMove',
      x: rect.x + 100,
      y: rect.y + 80,
      movementX: 100,
      movementY: 80,
    });
    first.webContents.sendInputEvent({
      type: 'mouseUp',
      x: rect.x + 100,
      y: rect.y + 80,
      button: 'left',
      clickCount: 1,
    });
    await pause(150);
    assert.equal(
      await js('document.querySelector(".capture-mode-menu").offsetTop'),
      rect.top
    );
    assert.ok(
      await js(
        `document.querySelector('.capture-mode-menu').offsetLeft > ${rect.left + 50}`
      )
    );
    await js('document.querySelector("[data-mode=record]").click()');
    for (const win of windows)
      await wait(() =>
        win.webContents.executeJavaScript(
          'document.querySelector("[data-mode=record]").getAttribute("aria-pressed")==="true"'
        )
      );
    assert.equal(
      await js(
        'getComputedStyle(document.querySelector(".selection")).getPropertyValue("--snapora-accent").trim()'
      ),
      '#f06454'
    );
    await windows
      .at(-1)
      .webContents.executeJavaScript(
        'document.querySelector("[data-mode=screenshot]").click()'
      );
    for (const win of windows)
      await wait(() =>
        win.webContents.executeJavaScript(
          'document.querySelector("[data-mode=screenshot]").getAttribute("aria-pressed")==="true"'
        )
      );
    assert.equal(
      await js('document.querySelector(".selection").hidden'),
      true,
      'menu drag must not select a region'
    );
    first.webContents.sendInputEvent({
      type: 'mouseDown',
      x: 80,
      y: 160,
      button: 'left',
      clickCount: 1,
    });
    first.webContents.sendInputEvent({
      type: 'mouseMove',
      x: 500,
      y: 400,
      movementX: 420,
      movementY: 240,
    });
    first.webContents.sendInputEvent({
      type: 'mouseUp',
      x: 500,
      y: 400,
      button: 'left',
      clickCount: 1,
    });
    await wait(() => js('!document.querySelector(".screen-frame").hidden'));
    assert.equal(await js('document.querySelector(".capture-mode-menu").hidden'), true);
    manager.cancel();
    assert.equal((await result).status, 'cancelled');
    manager.dispose();
    clearTimeout(deadline);
    console.log('RECORDING_MENU_SMOKE_OK', { displays: windows.length });
    app.exit(0);
  } catch (error) {
    console.error(error);
    manager?.dispose();
    clearTimeout(deadline);
    app.exit(1);
  }
});
