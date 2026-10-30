/** Tests the real Windows provider against a visible app; only drives our overlay. */
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { app, BrowserWindow, screen } = require('electron');
const {
  ScreenshotManager,
  createWindowsSnapProvider,
} = require('electron-snapora/main');

const fixture = process.argv.includes('--fixture');
const pid = fixture
  ? process.pid
  : Number(process.argv.find((arg) => arg.startsWith('--pid='))?.slice(6));
const drag = process.argv.includes('--drag');
const granularity =
  process.argv.find((arg) => arg.startsWith('--granularity='))?.slice(14) ?? 'panel';
// A smoke process must not contend with an already-running demo's Chromium cache.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-windows-smoke-')));
if (!Number.isSafeInteger(pid) || pid <= 0)
  throw new Error('Pass --pid=<visible target process id>.');
let candidates = [];
let manager;
let diagnostics;
const deadline = setTimeout(() => {
  console.error('Windows snap smoke timed out');
  app.exit(1);
}, 20_000);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const contains = (r, p) =>
  p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;

app.on('browser-window-created', (_event, window) => {
  window.once(
    'show',
    () =>
      void verify(window).catch((error) => {
        console.error(error);
        clearTimeout(deadline);
        manager?.dispose();
        app.exit(1);
      })
  );
});

async function verify(window) {
  while (!window.isDestroyed() && window.getOpacity() < 1) await pause(20);
  await window.webContents.executeJavaScript(`new Promise(resolve => {
    const check = () => document.querySelector('.capture-surface')?.dataset.state === 'ready'
      ? resolve() : requestAnimationFrame(check); check();
  })`);
  const display = screen.getDisplayMatching(window.getBounds());
  const sorted = candidates
    .filter((r) => r.width >= 4 && r.height >= 4)
    .sort(
      (a, b) =>
        (a.windowZOrder ?? 0) - (b.windowZOrder ?? 0) ||
        a.width * a.height - b.width * b.height
    );
  let candidate;
  let point;
  for (const r of sorted) {
    if (
      r.sourceProcessId !== pid ||
      r.kind !== (granularity === 'window' ? 'window' : 'container') ||
      r.width < 150 ||
      r.height < 80
    )
      continue;
    const p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    if (
      contains(display.bounds, p) &&
      sorted.find((other) => contains(other, p)) === r
    ) {
      candidate = r;
      point = p;
      break;
    }
  }
  assert.ok(
    candidate,
    'No visible candidate at the requested granularity; foreground the target before testing.'
  );
  const x = point.x - display.bounds.x,
    y = point.y - display.bounds.y;
  window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  await pause(100);
  const preview = await window.webContents.executeJavaScript(`(() => {
    const e = document.querySelector('.window-snap-preview'); const r = e.getBoundingClientRect();
    return {hidden:e.hidden,x:r.x,y:r.y,width:r.width,height:r.height};
  })()`);
  assert.equal(preview.hidden, false);
  for (const [key, value] of Object.entries({
    x: candidate.x - display.bounds.x,
    y: candidate.y - display.bounds.y,
    width: candidate.width,
    height: candidate.height,
  })) {
    assert.ok(
      Math.abs(preview[key] - value) <= 1,
      `${key}: preview=${preview[key]} expected=${value}`
    );
  }
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x,
    y,
  });
  if (drag) {
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: x + 64,
      y: y + 48,
      modifiers: ['leftButtonDown'],
    });
  }
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    x: drag ? x + 64 : x,
    y: drag ? y + 48 : y,
  });
  await pause(80);
  const selection = await window.webContents.executeJavaScript(`(() => {
    const e = document.querySelector('.selection'); const r = e.getBoundingClientRect();
    return {hidden:e.hidden,x:r.x,y:r.y,width:r.width,height:r.height};
  })()`);
  assert.equal(selection.hidden, false);
  const expectedSelection = drag ? { x, y, width: 64, height: 48 } : preview;
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(selection[key] - expectedSelection[key]) <= 1);
  console.log(
    JSON.stringify(
      {
        targetPid: pid,
        granularity,
        diagnostics,
        targetWindows: candidates.filter(
          (r) => r.sourceProcessId === pid && r.kind === 'window'
        ).length,
        targetContainers: candidates.filter(
          (r) => r.sourceProcessId === pid && r.kind === 'container'
        ).length,
        display: { bounds: display.bounds, scaleFactor: display.scaleFactor },
        selected: candidate,
        hover: true,
        click: !drag,
        drag,
      },
      null,
      2
    )
  );
  manager.cancel();
}

app
  .whenReady()
  .then(async () => {
    const provider = createWindowsSnapProvider({
      granularity,
      onDiagnostic: (event) => {
        diagnostics = event;
      },
    });
    manager = new ScreenshotManager({
      getWindowSnapRegions: async (signal) => {
        candidates = fixture
          ? [
              {
                x: 200,
                y: 200,
                width: 600,
                height: 400,
                windowZOrder: 0,
                kind: 'container',
                sourceProcessId: pid,
              },
            ]
          : await provider(signal);
        return candidates;
      },
    });
    const display =
      process.argv.find((arg) => arg.startsWith('--display='))?.slice(10) ?? 'cursor';
    const result = await manager.capture({ display });
    assert.equal(result.status, 'cancelled');
    clearTimeout(deadline);
    manager.dispose();
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  });
