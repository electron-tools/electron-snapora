/** Recorder isolation and crash recovery, using only test-owned Electron windows. */
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  session,
  globalShortcut,
} = require('electron');
const { ScreenshotManager, OVERLAY_CHANNELS } = require('../../dist/main/index.cjs');
const dir = mkdtempSync(join(tmpdir(), 'snapora-recording-fault-'));
app.setPath('userData', join(dir, 'profile'));
app.on('window-all-closed', () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let manager;
const timer = setTimeout(() => {
  manager?.dispose();
  app.exit(1);
}, 60000);
async function wait(predicate) {
  for (let i = 0; i < 200; i++) {
    const v = await predicate();
    if (v) return v;
    await sleep(100);
  }
  throw new Error('Timed out');
}
app.whenReady().then(async () => {
  try {
    let hostRequests = 0;
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      hostRequests++;
      callback({});
    });
    const display = screen.getPrimaryDisplay();
    const fixturePath = join(dir, 'fixture.html');
    writeFileSync(
      fixturePath,
      '<html><body style="background:#458b5a;color:white;font:44px sans-serif">Recording isolation test</body></html>'
    );
    const fixture = new BrowserWindow({
      x: display.bounds.x + 30,
      y: display.bounds.y + 80,
      width: 700,
      height: 400,
    });
    await fixture.loadFile(fixturePath);
    manager = new ScreenshotManager();
    const select = async () => {
      let ready;
      const listener = (event, payload) => {
        ready = {
          win: BrowserWindow.fromWebContents(event.sender),
          jobId: payload.jobId,
        };
      };
      ipcMain.on(OVERLAY_CHANNELS.selectionReady, listener);
      const result = manager.record({
        display: String(display.id),
        locale: process.env.SNAPORA_SMOKE_LOCALE || 'zh-CN',
      });
      await wait(() => ready);
      await ready.win.webContents.executeJavaScript(
        `window.snaporaOverlay.selected(${JSON.stringify({ jobId: ready.jobId, displayId: String(display.id), selection: { x: 50, y: 100, width: 600, height: 300 } })})`
      );
      ipcMain.removeListener(OVERLAY_CHANNELS.selectionReady, listener);
      const recorder = await wait(() =>
        BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('recording.html')
        )
      );
      await wait(() =>
        recorder.webContents.executeJavaScript(
          'document.getElementById("dimensions").textContent && !document.getElementById("start").disabled'
        )
      );
      return { recorder, result };
    };
    const first = await select();
    const preparedBounds = first.recorder.getBounds();
    assert.equal(
      preparedBounds.x,
      display.bounds.x + 180,
      'preparation is centered over selected region'
    );
    assert.equal(preparedBounds.y, display.bounds.y + 172);
    assert.equal(
      await first.recorder.webContents.executeJavaScript(`
      !document.querySelector('header') &&
      document.getElementById('limit').getClientRects().length === 0 &&
      !document.querySelector('.switch')
    `),
      true,
      'preparation has no heading, limit or trailing switches'
    );
    writeFileSync(
      join(dir, 'preparation.png'),
      (await first.recorder.webContents.capturePage()).toPNG()
    );
    console.log('RECORDING_PREPARATION_IMAGE', join(dir, 'preparation.png'));
    const controls = await first.recorder.webContents.executeJavaScript(`(() => {
      const system = document.getElementById('system');
      const mic = document.getElementById('microphone');
      system.click(); mic.click();
      const both = [system, mic].every(b => b.getAttribute('aria-pressed') === 'true');
      document.querySelector('input[value="gif"]').click();
      const silent = [system, mic].every(b => b.disabled && b.getAttribute('aria-pressed') === 'false');
      document.querySelector('input[value="mp4"]').click();
      const restored = [system, mic].every(b => !b.disabled && b.getAttribute('aria-pressed') === 'true');
      system.click(); mic.click();
      return { both, silent, restored };
    })()`);
    assert.deepEqual(controls, { both: true, silent: true, restored: true });
    assert.equal(
      await first.recorder.webContents.executeJavaScript(
        'document.documentElement.scrollHeight <= innerHeight'
      ),
      true,
      'preparation controls must fit the window'
    );
    const attacker = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: resolve(__dirname, '../../dist/recording/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    await attacker.loadFile(fixturePath);
    const denied = await attacker.webContents.executeJavaScript(
      'window.snaporaRecording.request("init").then(()=>false,()=>true)'
    );
    assert.equal(
      denied,
      true,
      'another renderer must not obtain recorder geometry or write capability'
    );
    attacker.destroy();
    assert.equal(manager.cancel(), true);
    assert.deepEqual(await first.result, { status: 'cancelled' });
    const second = await select();
    await second.recorder.webContents.executeJavaScript(
      'document.getElementById("start").click()',
      true
    );
    const countdown = await wait(() =>
      BrowserWindow.getAllWindows().find(
        (w) =>
          w.getTitle() === 'Snapora countdown' &&
          w.isVisible() &&
          !w.webContents.isLoading()
      )
    );
    assert.equal(
      second.recorder.isVisible(),
      false,
      'preparation must hide before countdown'
    );
    writeFileSync(
      join(dir, 'countdown.png'),
      (await countdown.webContents.capturePage()).toPNG()
    );
    await wait(() =>
      second.recorder.webContents.executeJavaScript(
        '!document.getElementById("active").hidden'
      )
    );
    await sleep(3200);
    const activeBounds = second.recorder.getBounds();
    assert.deepEqual(activeBounds, {
      x: display.bounds.x + 330,
      y: display.bounds.y + 406,
      width: 320,
      height: 52,
    });
    assert.equal(
      await second.recorder.webContents.executeJavaScript(`
      document.getElementById('limit').getClientRects().length > 0 &&
      document.documentElement.scrollHeight <= innerHeight &&
      document.documentElement.scrollWidth <= innerWidth
    `),
      true,
      'active bar shows duration limit and fits its compact window'
    );
    const outline = BrowserWindow.getAllWindows().find(
      (w) => w.getTitle() === 'Snapora recording outline'
    );
    assert.ok(outline?.isVisible(), 'recording keeps a visible external outline');
    assert.equal(outline.isFocusable(), false, 'outline must not take focus');
    const masks = await outline.webContents.executeJavaScript(`
      [...document.querySelectorAll('b')].map(el => {
        const r = el.getBoundingClientRect();
        return { x:r.x, y:r.y, width:r.width, height:r.height, color:getComputedStyle(el).backgroundColor };
      })
    `);
    assert.equal(masks.length, 4, 'recording dims all four sides of the selected area');
    for (const r of masks) {
      assert.equal(r.color, 'rgba(0, 0, 0, 0.4)');
      assert.ok(
        r.x + r.width <= 50 || r.x >= 650 || r.y + r.height <= 100 || r.y >= 400,
        'dimming must never enter the recorded area'
      );
    }
    writeFileSync(
      join(dir, 'active.png'),
      (await second.recorder.webContents.capturePage()).toPNG()
    );
    await second.recorder.webContents.executeJavaScript(
      'window.snaporaRecording.request("bar-drag")'
    );
    await second.recorder.webContents.executeJavaScript(
      'window.snaporaRecording.request("bar-move", {dx:80,dy:30})'
    );
    const dragged = second.recorder.getBounds();
    assert.equal(dragged.x, activeBounds.x + 80);
    assert.equal(dragged.y, activeBounds.y + 30);
    if (process.platform === 'win32') {
      await second.recorder.webContents.executeJavaScript(
        'window.snaporaRecording.request("bar-move", {dx:-100,dy:-170})'
      );
      assert.equal(
        second.recorder.getBounds().y,
        activeBounds.y - 170,
        'Windows controls can move into the selected area'
      );
      assert.ok(
        second.recorder.isContentProtected(),
        'overlapping controls must be excluded from capture'
      );
    }
    second.recorder.webContents.forcefullyCrashRenderer();
    const failure = await second.result;
    assert.equal(failure.status, 'failed');
    assert.ok(failure.recoveryPath && existsSync(failure.recoveryPath));
    const partial = readFileSync(failure.recoveryPath);
    assert.ok(partial.includes(Buffer.from('moof')));
    assert.equal(globalShortcut.isRegistered('CommandOrControl+Alt+Shift+R'), false);
    assert.equal(manager.activeJobId, undefined);
    assert.equal(
      outline.isDestroyed(),
      true,
      'failure must remove the recording outline'
    );
    assert.equal(hostRequests, 0, 'host defaultSession must remain untouched');
    console.log('RECORDING_FAULT_SMOKE_OK', failure);
    manager.dispose();
    fixture.destroy();
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    console.error(error);
    manager?.dispose();
    clearTimeout(timer);
    app.exit(1);
  }
});
