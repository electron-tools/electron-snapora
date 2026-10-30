/** Real OS cursor stays visible while native capture excludes cursor and protected overlay pixels. */
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron');
const {
  ScreenshotManager,
  ElectronCaptureAdapter,
  OVERLAY_CHANNELS,
} = require('electron-snapora/main');
const koffi = require('koffi');
const cursorInfoType = koffi.struct('SnaporaCursorInfo', {
  cbSize: 'uint32',
  flags: 'uint32',
  hCursor: 'void *',
  point: koffi.struct({ x: 'long', y: 'long' }),
});
const getCursorInfo = koffi
  .load('user32.dll')
  .func('int __stdcall GetCursorInfo(_Inout_ SnaporaCursorInfo * info)');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-cursor-')));
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let manager, adapter, fixture, overlay, release;
const timer = setTimeout(() => {
  console.error('Cursor test timed out');
  app.exit(1);
}, 45000);
ipcMain.on(OVERLAY_CHANNELS.selectionReady, (event) => {
  overlay = BrowserWindow.fromWebContents(event.sender);
});
async function wait(check) {
  for (let i = 0; i < 300; i++) {
    const value = await check();
    if (value) return value;
    await pause(20);
  }
  throw Error('Cursor state timed out');
}
function assertNativeCursor() {
  const info = { cbSize: koffi.sizeof(cursorInfoType) };
  assert.equal(getCursorInfo(info), 1);
  assert.equal(info.flags & 1, 1, 'Real Windows cursor must remain visible');
}
app
  .whenReady()
  .then(async () => {
    try {
      const point = screen.getCursorScreenPoint(),
        display = screen.getDisplayNearestPoint(point);
      const local = { x: point.x - display.bounds.x, y: point.y - display.bounds.y };
      assert.ok(
        local.x > 60 &&
          local.y > 60 &&
          local.x < display.bounds.width - 60 &&
          local.y < display.bounds.height - 60,
        'Keep pointer stationary at least 60 DIP inside its display'
      );
      fixture = new BrowserWindow({ ...display.bounds, frame: false, show: false });
      await fixture.loadFile(join(__dirname, 'capture-exclusion.html'));
      fixture.show();
      fixture.setBounds(display.bounds);
      fixture.setAlwaysOnTop(true, 'screen-saver');
      fixture.moveTop();
      await pause(150);
      adapter = new ElectronCaptureAdapter();
      const capture = adapter.capture.bind(adapter);
      let barrier;
      adapter.capture = async (...args) => {
        await barrier;
        return capture(...args);
      };
      let exported;
      manager = new ScreenshotManager({
        captureAdapter: adapter,
        outputAdapter: {
          execute: async (payload) => {
            exported = nativeImage.createFromBuffer(Buffer.from(payload.result.data));
            return { status: 'completed', action: 'copy' };
          },
        },
      });
      await manager.prepare({ display: String(display.id), interactionMode: 'live' });
      const evidence = [],
        directory = join(__dirname, '../../.pack-preview');
      mkdirSync(directory, { recursive: true });
      for (const outside of [false, true]) {
        barrier = new Promise((resolve) => {
          release = resolve;
        });
        overlay = undefined;
        const task = manager.capture({
          display: String(display.id),
          interactionMode: 'live',
        });
        await wait(() => overlay);
        const read = (code) => overlay.webContents.executeJavaScript(code);
        // Keep the physical pointer stationary; drive only our own overlay's input.
        const start = outside
          ? {
              x: local.x > display.bounds.width / 2 ? 80 : display.bounds.width - 400,
              y: 80,
            }
          : { x: local.x - 50, y: local.y - 50 };
        const end = outside
          ? { x: start.x + 300, y: start.y + 200 }
          : { x: start.x + 100, y: start.y + 100 };
        overlay.webContents.sendInputEvent({ type: 'mouseMove', ...start });
        overlay.webContents.sendInputEvent({
          type: 'mouseDown',
          button: 'left',
          clickCount: 1,
          ...start,
        });
        overlay.webContents.sendInputEvent({ type: 'mouseMove', ...end });
        overlay.webContents.sendInputEvent({
          type: 'mouseUp',
          button: 'left',
          clickCount: 1,
          ...end,
        });
        await wait(() =>
          read("document.querySelector('.capture-surface').dataset.state==='capturing'")
        );
        overlay.webContents.sendInputEvent({ type: 'mouseMove', ...local });
        await pause(40);
        assertNativeCursor();
        assert.equal(
          await read("document.querySelector('.capture-pointer')===null"),
          true
        );
        assert.notEqual(
          await read(
            `getComputedStyle(document.elementFromPoint(${local.x},${local.y})).cursor`
          ),
          'none'
        );
        const started = performance.now();
        release();
        await wait(() =>
          read("document.querySelector('.capture-surface').dataset.state==='selected'")
        );
        const imageMs = Math.round(performance.now() - started);
        assertNativeCursor();
        assert.deepEqual(
          screen.getCursorScreenPoint(),
          point,
          'Pointer moved during capture test'
        );
        // Inspect full backing image, including outside the current crop, to cover later resizing.
        const fullFrame = nativeImage.createFromDataURL(
          await read("document.querySelector('.screen-frame').toDataURL()")
        );
        const size = fullFrame.getSize(),
          sx = size.width / display.bounds.width,
          sy = size.height / display.bounds.height;
        const patch = fullFrame.crop({
          x: Math.round((local.x - 48) * sx),
          y: Math.round((local.y - 48) * sy),
          width: Math.round(96 * sx),
          height: Math.round(96 * sy),
        });
        writeFileSync(
          join(directory, `native-cursor-${outside ? 'outside' : 'inside'}.png`),
          patch.toPNG()
        );
        const pixels = patch.toBitmap();
        let changed = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            Math.abs(pixels[i] - 60) > 14 ||
            Math.abs(pixels[i + 1] - 180) > 14 ||
            Math.abs(pixels[i + 2] - 20) > 14
          )
            changed++;
        assert.equal(
          changed,
          0,
          'No native cursor or protected mask may appear in the backing image'
        );
        await read("document.querySelector('.confirm-button').click()");
        assert.equal((await task).status, 'completed');
        assert.ok(exported.getSize().width > 0);
        evidence.push({
          outside,
          displayId: display.id,
          scale: display.scaleFactor,
          changed,
          imageMs,
          nativeCursorVisible: true,
        });
        console.log(evidence.at(-1));
      }
      writeFileSync(
        join(directory, 'native-cursor-evidence.json'),
        JSON.stringify(evidence, null, 2)
      );
    } finally {
      release?.();
      manager?.dispose();
      adapter?.dispose();
      fixture?.destroy();
      clearTimeout(timer);
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
