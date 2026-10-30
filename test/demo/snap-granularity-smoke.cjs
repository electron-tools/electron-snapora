/** Exercise the real demo select, preload IPC and all three native capture modes. */
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app, ipcMain, screen } = require('electron');
const { OVERLAY_CHANNELS } = require('electron-snapora/main');

app.disableHardwareAcceleration();
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-granularity-smoke-')));
let host;
let captureReady;
let discoveryReady;
let capturePrepared;
const liveWindows = new Map();
ipcMain.on(OVERLAY_CHANNELS.prepared, () => capturePrepared?.(performance.now()));
let latestRegions = [];
const log = console.log;
console.log = (...args) => {
  if (args[0] === '[Windows container snap]') discoveryReady?.(args[1]);
  log(...args);
};
const hostReady = new Promise((resolve) => {
  app.on('browser-window-created', (_event, window) => {
    if (!host) {
      host = window;
      window.webContents.once('did-finish-load', resolve);
    } else {
      const send = window.webContents.send.bind(window.webContents);
      window.webContents.send = (channel, payload, ...rest) => {
        if (channel === OVERLAY_CHANNELS.selectInitialize)
          liveWindows.set(payload.display.id, window);
        if (channel === OVERLAY_CHANNELS.initialize) {
          latestRegions = payload.windowSnapRegions ?? [];
          captureReady?.({ window, payload });
        }
        if (channel === OVERLAY_CHANNELS.snapRegions) latestRegions = payload.regions;
        return send(channel, payload, ...rest);
      };
    }
  });
});
let stage = 'startup';
const deadline = setTimeout(() => {
  console.error('Granularity demo smoke timed out at', stage);
  app.exit(1);
}, 45_000);
require('../../demo/main.cjs');

async function waitForHost(expression) {
  for (let i = 0; i < 200; i++) {
    if (await host.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Host did not settle at ' + stage);
}

async function state() {
  return host.webContents.executeJavaScript(`window.demoSnapApi.get()`);
}

app
  .whenReady()
  .then(async () => {
    await hostReady;
    await waitForHost("!document.querySelector('#snap-granularity').disabled");
    assert.deepEqual(await state(), { supported: true, granularity: 'panel' });
    assert.equal(
      (await host.webContents.executeJavaScript('window.demoInteractionApi.get()'))
        .mode,
      'live'
    );
    await host.webContents.executeJavaScript(
      `(() => {const select=document.querySelector('#interaction-mode');select.value='frozen';select.dispatchEvent(new Event('change'));})()`
    );
    await waitForHost("!document.querySelector('#interaction-mode').disabled");
    const errors = await host.webContents.executeJavaScript(`Promise.all([
    window.demoSnapApi.set('buttons').then(()=>false,()=>true),
    window.demoSnapApi.set({granularity:'fine'}).then(()=>false,()=>true),
  ])`);
    assert.deepEqual(errors, [true, true]);
    const evidence = [];
    for (const mode of ['window', 'panel', 'fine']) {
      stage = 'select-' + mode;
      console.log('[granularity smoke]', stage);
      await host.webContents.executeJavaScript(`(() => {
      const select=document.querySelector('#snap-granularity');
      select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('change'));
      
    })()`);
      await waitForHost("!document.querySelector('#snap-granularity').disabled");
      assert.equal((await state()).granularity, mode);
      stage = 'capture-' + mode;
      const initialized = new Promise((resolve) => {
        captureReady = resolve;
      });
      const discovered = new Promise((resolve) => {
        discoveryReady = resolve;
      });
      const prepared = new Promise((resolve) => {
        capturePrepared = resolve;
      });
      const started = performance.now();
      await host.webContents.executeJavaScript(
        `document.querySelector('.capture-button').click()`
      );
      const { window, payload } = await initialized;
      const initializeMs = Math.round(performance.now() - started);
      assert.ok((payload.windowSnapRegions ?? []).some((r) => r.kind === 'window'));
      // Windows prime() is already visible but transparent: measure actual frame preparation.
      const visibleMs = Math.round((await prepared) - started);
      const diagnostic = await discovered;
      assert.equal(diagnostic.status, 'completed');
      const regions = latestRegions;
      assert.ok(regions.some((r) => r.kind === 'window'));
      if (mode === 'window') assert.ok(regions.every((r) => r.kind === 'window'));
      if (mode === 'panel')
        assert.ok(
          regions
            .filter((r) => r.kind === 'container')
            .every((r) => r.width >= 160 && r.height >= 120)
        );
      const busyRejected = await host.webContents.executeJavaScript(
        `window.demoSnapApi.set('window').then(()=>false,()=>true)`
      );
      assert.equal(busyRejected, true);
      evidence.push({
        mode,
        initializeMs,
        visibleMs,
        diagnostic,
        windows: regions.filter((r) => r.kind === 'window').length,
        containers: regions.filter((r) => r.kind === 'container').length,
      });
      await host.webContents.executeJavaScript(`window.electronSnapora.cancel()`);
      await waitForHost("!document.querySelector('.capture-button').disabled");
      assert.equal(
        window.isDestroyed() || !window.isVisible() || window.getOpacity() === 0,
        true
      );
    }
    // Restore the demo default and retain a screenshot of the comparison control for inspection.
    await host.webContents.executeJavaScript(`(() => {
    const select=document.querySelector('#snap-granularity');select.value='panel';select.dispatchEvent(new Event('change'));
  })()`);
    await waitForHost("!document.querySelector('#snap-granularity').disabled");
    stage = 'demo-live-selection';
    await host.webContents.executeJavaScript(
      `(() => {const select=document.querySelector('#interaction-mode');select.value='live';select.dispatchEvent(new Event('change'));})()`
    );
    await waitForHost("!document.querySelector('#interaction-mode').disabled");
    await host.webContents.executeJavaScript(
      `document.querySelector('.capture-button').click()`
    );
    for (let i = 0; i < 200 && liveWindows.size !== screen.getAllDisplays().length; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(liveWindows.size, screen.getAllDisplays().length);
    for (const window of liveWindows.values()) {
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.screen-frame').width`
        ),
        0
      );
    }
    const live = [...liveWindows.values()].at(-1);
    const liveInitialized = new Promise((resolve) => {
      captureReady = resolve;
    });
    live.webContents.sendInputEvent({ type: 'mouseMove', x: 180, y: 180 });
    live.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x: 180,
      y: 180,
    });
    live.webContents.sendInputEvent({ type: 'mouseMove', x: 300, y: 260 });
    live.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: 300,
      y: 260,
    });
    await liveInitialized;
    await host.webContents.executeJavaScript(`window.electronSnapora.cancel()`);
    await waitForHost("!document.querySelector('.capture-button').disabled");
    const preview = join(__dirname, '../../.pack-preview');
    mkdirSync(preview, { recursive: true });
    host.show();
    host.focus();
    await host.webContents.executeJavaScript(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    );
    writeFileSync(
      join(preview, 'snap-granularity-demo.png'),
      (await host.webContents.capturePage()).toPNG()
    );
    console.log(
      JSON.stringify(
        {
          default: 'panel',
          modes: evidence,
          invalidRejected: true,
          busyRejected: true,
        },
        null,
        2
      )
    );
    writeFileSync(
      join(preview, 'snap-granularity-timing.json'),
      JSON.stringify(evidence, null, 2)
    );
    clearTimeout(deadline);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  });
