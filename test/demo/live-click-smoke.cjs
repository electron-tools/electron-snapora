/** Exercise single-click selection through the real demo IPC and default capture adapter. */
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { OVERLAY_CHANNELS } = require('electron-snapora/main');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-live-click-')));
const windows = new Map();
let host;
let stage = 'startup';
let emptyCandidates = false;
let latestRegions = [];
let streamErrors = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = setTimeout(() => {
  console.error('Timeout:', stage);
  app.exit(1);
}, 45000);
app.on('browser-window-created', (_event, window) => {
  const send = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, payload, ...rest) => {
    if (channel === OVERLAY_CHANNELS.selectInitialize) {
      payload = {
        ...payload,
        windowSnapRegions: emptyCandidates
          ? []
          : (payload.windowSnapRegions ?? []).filter(
              (r) => r.sourceProcessId === process.pid
            ),
      };
    } else if (channel === OVERLAY_CHANNELS.snapRegions) {
      latestRegions = payload.regions;
      // Isolate this demo fixture from unrelated always-on-top desktop/automation windows.
      payload = {
        ...payload,
        regions: emptyCandidates
          ? []
          : payload.regions.filter((r) => r.sourceProcessId === process.pid),
      };
    }
    return send(channel, payload, ...rest);
  };
  window.webContents.on('did-finish-load', () => {
    if (window.webContents.getURL().includes('/demo/index.html')) host = window;
  });
});
ipcMain.on(OVERLAY_CHANNELS.selectionReady, (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  windows.set(window.getBounds().x, window);
});
ipcMain.on(OVERLAY_CHANNELS.error, (_event, payload) => {
  assert.match(payload.message, /CreateForMonitor E_ACCESSDENIED/);
  streamErrors++;
});
require('../../demo/main.cjs');
async function waitUntil(predicate) {
  for (let i = 0; i < 300; i++) {
    const value = await predicate();
    if (value) return value;
    await pause(20);
  }
  throw new Error('Timed out: ' + stage);
}
app
  .whenReady()
  .then(async () => {
    await waitUntil(() => host);
    await waitUntil(() =>
      host.webContents.executeJavaScript(
        "!document.querySelector('#interaction-mode').disabled"
      )
    );
    for (const display of screen.getAllDisplays()) {
      for (const mode of ['window', 'denied-stream', 'blank']) {
        stage = mode + '-' + display.id;
        emptyCandidates = mode === 'blank';
        latestRegions = [];
        const bounds = display.bounds;
        host.setBounds({
          x: bounds.x + 100,
          y: bounds.y + 100,
          width: 800,
          height: 640,
        });
        host.show();
        host.setAlwaysOnTop(true, 'screen-saver');
        host.moveTop();
        windows.clear();
        await host.webContents.executeJavaScript(
          "document.querySelector('.capture-button').click()"
        );
        await waitUntil(() => windows.size === screen.getAllDisplays().length);
        const overlay = windows.get(bounds.x);
        let expected = { x: 0, y: 0, width: bounds.width, height: bounds.height };
        let point = { x: 150, y: 150 };
        if (!emptyCandidates) {
          await waitUntil(() =>
            latestRegions.some(
              (r) =>
                r.sourceProcessId === process.pid &&
                r.kind === 'window' &&
                Math.abs(r.x - host.getBounds().x) < 20
            )
          );
          const region = latestRegions.find(
            (r) =>
              r.sourceProcessId === process.pid &&
              r.kind === 'window' &&
              Math.abs(r.x - host.getBounds().x) < 20
          );
          expected = {
            x: region.x - bounds.x,
            y: region.y - bounds.y,
            width: region.width,
            height: region.height,
          };
          // Title-bar whitespace is outside UIA content panels: it must select the window itself.
          point = {
            x: Math.round(expected.x + expected.width / 2),
            y: Math.round(expected.y + 8),
          };
        }
        overlay.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        const preview = await waitUntil(() =>
          overlay.webContents.executeJavaScript(
            `(() => {const e=document.querySelector('.window-snap-preview'),r=e.getBoundingClientRect();return !e.hidden && Math.abs(r.x-${expected.x})<2 && Math.abs(r.width-${expected.width})<2 ? {x:r.x,y:r.y,width:r.width,height:r.height} : false})()`
          )
        );
        for (const key of ['x', 'y', 'width', 'height'])
          assert.ok(
            Math.abs(preview[key] - expected[key]) < 2,
            stage + ': incorrect ' + key + JSON.stringify({ preview, expected, point })
          );
        if (mode === 'denied-stream')
          await overlay.webContents.executeJavaScript(
            `navigator.mediaDevices.getUserMedia = async () => {throw new DOMException('CreateForMonitor E_ACCESSDENIED', 'NotAllowedError')}; undefined`
          );
        const clickedAt = performance.now();
        overlay.webContents.sendInputEvent({
          type: 'mouseDown',
          button: 'left',
          clickCount: 1,
          ...point,
        });
        overlay.webContents.sendInputEvent({
          type: 'mouseUp',
          button: 'left',
          clickCount: 1,
          ...point,
        });
        await waitUntil(() =>
          overlay.webContents.executeJavaScript(
            "!document.querySelector('.selection-toolbar').hidden"
          )
        );
        const toolbarMs = Math.round(performance.now() - clickedAt);
        await waitUntil(() =>
          overlay.webContents.executeJavaScript(
            "document.querySelector('.capture-surface').dataset.state==='selected'"
          )
        );
        const imageMs = Math.round(performance.now() - clickedAt);
        console.log('[single click timing]', { stage, toolbarMs, imageMs });
        await pause(250);
        const state = await overlay.webContents.executeJavaScript(
          `({phase:document.querySelector('.capture-surface').dataset.state,toolbar:!document.querySelector('.selection-toolbar').hidden,selection:!document.querySelector('.selection').hidden})`
        );
        console.log(
          stage,
          state,
          'visible:',
          overlay.isVisible(),
          'result:',
          await host.webContents.executeJavaScript(
            "document.querySelector('.result').textContent"
          )
        );
        assert.equal(overlay.isVisible(), true);
        assert.equal(state.phase, 'selected');
        assert.equal(state.toolbar, true);
        assert.equal(state.selection, true);
        const selection = await overlay.webContents.executeJavaScript(
          `(() => {const r=document.querySelector('.selection').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`
        );
        for (const key of ['x', 'y', 'width', 'height'])
          assert.ok(
            Math.abs(selection[key] - expected[key]) < 2,
            stage + ': lost selected ' + key
          );
        assert.equal(
          await host.webContents.executeJavaScript(
            "document.querySelector('.capture-button').disabled"
          ),
          true,
          'A single click must not finish or export the capture'
        );
        await host.webContents.executeJavaScript('window.electronSnapora.cancel()');
        await waitUntil(() =>
          host.webContents.executeJavaScript(
            "!document.querySelector('.capture-button').disabled"
          )
        );
      }
    }
    assert.equal(
      streamErrors,
      0,
      'Native live capture must not invoke the denied WGC stream'
    );
    clearTimeout(deadline);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  });
