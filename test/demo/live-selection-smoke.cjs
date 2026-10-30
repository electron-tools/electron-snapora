/** Actual multi-display overlays + native discovery + post-selection stream acquisition. No external app input. */
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron');
const {
  ScreenshotManager,
  ElectronCaptureAdapter,
  createWindowsSnapProvider,
  createMacSnapProvider,
  OVERLAY_CHANNELS,
} = require('electron-snapora/main');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-live-')));
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('force-renderer-accessibility');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let manager, adapter, provider;
const fixtures = [];
const selecting = new Map();
let captureCount = 0,
  nativeRegions = [],
  stage = 'startup';
let exportCount = 0;
let captureBarrier;
let releaseCapture;
const deadline = setTimeout(() => {
  console.error('Live smoke timed out', stage);
  manager?.dispose();
  provider?.dispose();
  app.exit(1);
}, 45000);
ipcMain.on(OVERLAY_CHANNELS.selectionReady, (event) => {
  selecting.set(event.sender.id, BrowserWindow.fromWebContents(event.sender));
});
async function waitUntil(predicate) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await pause(20);
  }
  throw new Error('Timed out at ' + stage);
}
async function preview(window) {
  return window.webContents.executeJavaScript(
    `(() => {const e=document.querySelector('.window-snap-preview'),r=e.getBoundingClientRect();return {hidden:e.hidden,x:r.x,y:r.y,width:r.width,height:r.height}})()`
  );
}
app
  .whenReady()
  .then(async () => {
    try {
      const displays = screen.getAllDisplays();
      assert.ok(displays.length >= 2, 'This regression requires two real displays.');
      for (const display of displays) {
        const fixture = new BrowserWindow({
          x: display.bounds.x + 100,
          y: display.bounds.y + 100,
          width: 500,
          height: 360,
          frame: false,
          show: false,
          webPreferences: { backgroundThrottling: false },
        });
        fixtures.push(fixture);
        await fixture.loadFile(join(__dirname, 'capture-exclusion.html'));
        fixture.show();
        fixture.setAlwaysOnTop(true, 'screen-saver');
        fixture.moveTop();
      }
      adapter = new ElectronCaptureAdapter();
      const originalCapture = adapter.capture.bind(adapter);
      adapter.capture = async (...args) => {
        captureCount++;
        if (captureBarrier) await captureBarrier;
        return originalCapture(...args);
      };
      provider =
        process.platform === 'darwin'
          ? createMacSnapProvider({ granularity: 'panel' })
          : createWindowsSnapProvider({ keepAlive: true, granularity: 'panel' });
      if (process.platform === 'darwin') {
        const permissions = await provider.getPermissions();
        assert.ok(
          permissions.screenRecording && permissions.accessibility,
          'First grant Screen Recording and Accessibility in pnpm run demo:mac. This test never prompts.'
        );
      }
      manager = new ScreenshotManager({
        captureAdapter: adapter,
        outputAdapter: {
          execute: async (payload) => {
            exportCount++;
            assert.ok(
              nativeImage.createFromBuffer(Buffer.from(payload.result.data)).getSize()
                .width > 0
            );
            return { status: 'completed', action: 'copy' };
          },
        },
        getWindowSnapRegions: async (signal, update, context) => {
          const regions = await provider(signal, update, 'panel', context);
          if (!signal.aborted) nativeRegions = regions;
          return regions;
        },
      });
      await Promise.all([
        provider.prepare(),
        manager.prepare({ display: 'all', interactionMode: 'live' }),
      ]);
      const evidence = [];
      for (let selectedIndex = 0; selectedIndex < 2; selectedIndex++) {
        stage = 'selecting-' + selectedIndex;
        console.log(
          '[live smoke]',
          stage,
          fixtures.map((w) => w.getBounds())
        );
        selecting.clear();
        nativeRegions = [];
        const before = captureCount,
          started = performance.now();
        const result = manager.capture({ display: 'all', interactionMode: 'live' });
        await waitUntil(() => selecting.size === displays.length);
        const readyMs = Math.round(performance.now() - started);
        assert.equal(captureCount, before, 'Selection stage must not call capture');
        for (const window of selecting.values()) {
          assert.deepEqual(
            await window.webContents.executeJavaScript(
              `({width:document.querySelector('.screen-frame').width,height:document.querySelector('.screen-frame').height})`
            ),
            { width: 0, height: 0 }
          );
        }
        await waitUntil(
          () =>
            nativeRegions.filter(
              (r) => r.sourceProcessId === process.pid && r.kind === 'window'
            ).length === fixtures.length
        );
        await waitUntil(() =>
          displays.every((display) =>
            nativeRegions.some(
              (r) =>
                r.kind === 'container' &&
                r.sourceProcessId === process.pid &&
                r.x >= display.bounds.x &&
                r.x < display.bounds.x + display.bounds.width
            )
          )
        );
        // Both fixture windows remain detectable; our full-screen overlays are excluded by handle.
        const own = nativeRegions.filter(
          (r) => r.sourceProcessId === process.pid && r.kind === 'window'
        );
        assert.ok(own.every((r) => r.width < 700 && r.height < 500));
        const byDisplay = displays.map((display) =>
          [...selecting.values()].find(
            (window) =>
              window.getBounds().x === display.bounds.x &&
              window.getBounds().y === display.bounds.y
          )
        );
        for (const index of [0, 1, 0, 1]) {
          const window = byDisplay[index];
          window.webContents.sendInputEvent({ type: 'mouseMove', x: 220, y: 220 });
          await waitUntil(async () => !(await preview(window)).hidden);
          assert.ok((await preview(window)).width >= 160);
        }
        const selected = byDisplay[selectedIndex];
        const targetDisplay = displays[selectedIndex];
        // Change pixels AFTER live selection started; the resulting bitmap must contain the new color.
        await fixtures[selectedIndex].webContents.executeJavaScript(
          "document.body.style.background='rgb(30,80,220)';document.documentElement.style.background='rgb(30,80,220)'"
        );
        stage = 'capture-' + selectedIndex;
        const committed = performance.now();
        selected.webContents.sendInputEvent({
          type: 'mouseDown',
          button: 'left',
          clickCount: 1,
          x: 220,
          y: 220,
        });
        selected.webContents.sendInputEvent({
          type: 'mouseUp',
          button: 'left',
          clickCount: 1,
          x: 220,
          y: 220,
        });
        await waitUntil(async () =>
          selected.webContents.executeJavaScript(
            `document.querySelector('.capture-surface').dataset.state==='selected' && !document.querySelector('.screen-frame').hidden`
          )
        );
        const editMs = Math.round(performance.now() - committed);
        assert.equal(captureCount, before + 1);
        const pixel = await selected.webContents.executeJavaScript(
          `(() => {const canvas=document.querySelector('.screen-frame');return [...canvas.getContext('2d').getImageData(Math.round(220*canvas.width/${targetDisplay.bounds.width}),Math.round(220*canvas.height/${targetDisplay.bounds.height}),1,1).data]})()`
        );
        assert.ok(
          Math.abs(pixel[0] - 30) < 8 &&
            Math.abs(pixel[1] - 80) < 8 &&
            Math.abs(pixel[2] - 220) < 8,
          'Selected image includes stale pixels or overlay: ' + pixel
        );
        assert.ok(byDisplay.filter((w) => w !== selected).every((w) => !w.isVisible()));
        selected.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        selected.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        const output = await result;
        assert.equal(output.status, 'completed');
        assert.equal(output.displayId, String(targetDisplay.id));
        evidence.push({
          displayId: targetDisplay.id,
          scaleFactor: targetDisplay.scaleFactor,
          readyMs,
          editMs,
          pixel,
          capturedOnlyAfterSelection: true,
          crossScreenHover: true,
          excludedOwnOverlays: true,
          panelContainersOnBothDisplays: true,
          pngExported: true,
        });
      }
      stage = 'cancel-before-selection';
      selecting.clear();
      const before = captureCount;
      const cancelled = manager.capture({ display: 'all', interactionMode: 'live' });
      await waitUntil(() => selecting.size === displays.length);
      manager.cancel();
      assert.equal((await cancelled).status, 'cancelled');
      assert.equal(captureCount, before);
      assert.equal(exportCount, 2);
      stage = 'clamped-drag-and-cancel';
      captureBarrier = new Promise((resolve) => {
        releaseCapture = resolve;
      });
      console.log('[live smoke]', stage);
      selecting.clear();
      const dragging = manager.capture({ display: 'all', interactionMode: 'live' });
      await waitUntil(() => selecting.size === displays.length);
      const window = [...selecting.values()].find(
        (w) => w.getBounds().x === displays[0].bounds.x
      );
      const width = displays[0].bounds.width;
      window.webContents.sendInputEvent({ type: 'mouseMove', x: width - 60, y: 500 });
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'left',
        clickCount: 1,
        x: width - 60,
        y: 500,
      });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: width + 100, y: 540 });
      await waitUntil(async () =>
        window.webContents.executeJavaScript(
          `document.querySelector('.capture-surface').dataset.state==='creating'`
        )
      );
      const right = await window.webContents.executeJavaScript(
        `document.querySelector('.selection').getBoundingClientRect().right`
      );
      assert.equal(right, width);
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        button: 'left',
        clickCount: 1,
        x: width + 100,
        y: 540,
      });
      await waitUntil(() => captureCount === before + 1);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      assert.equal((await dragging).status, 'cancelled');
      releaseCapture();
      await pause(800);
      assert.equal(exportCount, 2);
      assert.ok(
        [...selecting.values()].every((w) => w.isDestroyed() || !w.isVisible())
      );
      const directory = join(__dirname, '../../.pack-preview');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(
          directory,
          process.platform === 'darwin'
            ? 'mac-live-selection-smoke.json'
            : 'live-selection-smoke.json'
        ),
        JSON.stringify(evidence, null, 2)
      );
      console.log(JSON.stringify(evidence, null, 2));
    } finally {
      manager?.dispose();
      provider?.dispose();
      adapter?.dispose();
      for (const window of fixtures) if (!window.isDestroyed()) window.destroy();
      clearTimeout(deadline);
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
