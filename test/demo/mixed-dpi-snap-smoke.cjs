/** A single real window spans two differently scaled monitors; both previews and clicks must match. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const {
  ScreenshotManager,
  createWindowsSnapProvider,
  OVERLAY_CHANNELS,
} = require('electron-snapora/main');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-mixed-dpi-')));
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let fixture, manager, provider, helper;
let regions = [];
const overlays = new Map();
const deadline = setTimeout(() => {
  console.error('Mixed-DPI snap smoke timed out');
  cleanup();
  app.exit(1);
}, 30000);
ipcMain.on(OVERLAY_CHANNELS.selectionReady, (event) =>
  overlays.set(event.sender.id, BrowserWindow.fromWebContents(event.sender))
);

function cleanup() {
  clearTimeout(deadline);
  helper?.kill();
  manager?.dispose();
  provider?.dispose();
  if (fixture && !fixture.isDestroyed()) fixture.destroy();
}
async function waitUntil(check) {
  for (let i = 0; i < 250; i++) {
    if (await check()) return;
    await pause(20);
  }
  throw new Error('Mixed-DPI state did not become ready');
}
async function rectangle(window, selector) {
  return window.webContents.executeJavaScript(
    `(() => { const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(); return {hidden:e.hidden,x:r.x,y:r.y,width:r.width,height:r.height}; })()`
  );
}
function sameRect(actual, expected) {
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= 1,
      `${key}: ${actual[key]} vs ${expected[key]}`
    );
}
// Read the existing native worker's physical rectangle, independently of the provider's DIP conversion.
async function physicalFixture() {
  return new Promise((resolve, reject) => {
    helper = spawn(
      join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-MTA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(__dirname, '../../src/electron/native/windows-snap.ps1'),
        '-Granularity',
        'window',
      ],
      { windowsHide: true }
    );
    let output = '';
    helper.stdout.on('data', (chunk) => {
      output += chunk;
    });
    helper.stderr.resume();
    helper.on('error', reject);
    helper.on('close', (code) => {
      try {
        assert.equal(code, 0);
        const own = output
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
          .filter((r) => r.kind === 'window' && r.processId === process.pid);
        assert.equal(own.length, 1);
        resolve(own[0]);
      } catch (error) {
        reject(error);
      }
    });
  });
}

app
  .whenReady()
  .then(async () => {
    try {
      const displays = screen.getAllDisplays();
      const left = displays.find((a) =>
        displays.some(
          (b) =>
            a.scaleFactor !== b.scaleFactor &&
            Math.abs(a.bounds.x + a.bounds.width - b.bounds.x) <= 1
        )
      );
      assert.ok(left, 'Requires horizontally adjacent displays with different DPI');
      const right = displays.find(
        (b) =>
          left.scaleFactor !== b.scaleFactor &&
          Math.abs(left.bounds.x + left.bounds.width - b.bounds.x) <= 1
      );
      fixture = new BrowserWindow({
        x: right.bounds.x - 200,
        y: Math.max(left.bounds.y, right.bounds.y) + 120,
        width: 800,
        height: 500,
        frame: false,
        show: false,
      });
      await fixture.loadFile(join(__dirname, 'capture-exclusion.html'));
      fixture.setAlwaysOnTop(true, 'screen-saver');
      fixture.show();
      await pause(100);
      const raw = await physicalFixture();
      const expected = [left, right].map((display) => {
        const physical = screen.dipToScreenRect(null, display.bounds);
        const x = Math.max(raw.x, physical.x),
          y = Math.max(raw.y, physical.y);
        const width = Math.min(raw.x + raw.width, physical.x + physical.width) - x;
        const height = Math.min(raw.y + raw.height, physical.y + physical.height) - y;
        assert.ok(
          width > 20 && height > 20,
          'Fixture must have a selectable piece on each monitor'
        );
        const dip = screen.screenToDipRect(null, { x, y, width, height });
        return {
          display,
          local: { ...dip, x: dip.x - display.bounds.x, y: dip.y - display.bounds.y },
        };
      });
      provider = createWindowsSnapProvider({ granularity: 'window', keepAlive: true });
      manager = new ScreenshotManager({
        getWindowSnapRegions: async (signal, update, context) => {
          regions = await provider(signal, update, context);
          return regions;
        },
      });
      await Promise.all([
        provider.prepare(),
        manager.prepare({ display: 'all', interactionMode: 'live' }),
      ]);
      const evidence = [];
      for (const { display, local } of expected) {
        overlays.clear();
        regions = [];
        const task = manager.capture({ display: 'all', interactionMode: 'live' });
        await waitUntil(
          () =>
            overlays.size === displays.length &&
            regions.some((r) => r.sourceProcessId === process.pid)
        );
        const piece = regions.find(
          (r) => r.sourceProcessId === process.pid && r.displayId === String(display.id)
        );
        assert.ok(piece);
        sameRect(
          { ...piece, x: piece.x - display.bounds.x, y: piece.y - display.bounds.y },
          local
        );
        const overlay = [...overlays.values()].find(
          (window) =>
            window.getBounds().x === display.bounds.x &&
            window.getBounds().y === display.bounds.y
        );
        const point = {
          x: Math.round(local.x + local.width / 2),
          y: Math.round(local.y + local.height / 2),
        };
        overlay.webContents.sendInputEvent({
          type: 'mouseMove',
          x: point.x + 4,
          y: point.y,
        });
        await pause(30);
        overlay.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        await pause(50);
        const hover = await rectangle(overlay, '.window-snap-preview');
        assert.equal(hover.hidden, false);
        sameRect(hover, local);
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
            "document.querySelector('.capture-surface').dataset.state==='selected' && document.querySelector('.selection-toolbar').getAttribute('aria-busy')==='false'"
          )
        );
        const selected = await rectangle(overlay, '.selection');
        assert.equal(selected.hidden, false);
        sameRect(selected, local);
        manager.cancel();
        assert.equal((await task).status, 'cancelled');
        evidence.push({
          displayId: display.id,
          scale: display.scaleFactor,
          expected: local,
          selected,
        });
      }
      console.log(
        JSON.stringify(
          { crossMonitorWindow: raw, previewsAndClicks: evidence },
          null,
          2
        )
      );
    } finally {
      cleanup();
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    cleanup();
    app.exit(1);
  });
