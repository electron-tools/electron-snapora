/** Real Electron capture/encode/write/preview regression. Only operates windows created by this test. */
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, screen, dialog, ipcMain } = require('electron');
const { ScreenshotManager, OVERLAY_CHANNELS } = require('../../dist/main/index.cjs');
const directory = mkdtempSync(join(tmpdir(), 'snapora-recording-smoke-'));
app.setPath('userData', join(directory, 'profile'));
app.on('window-all-closed', () => {});
let manager;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = Number(process.env.SNAPORA_SMOKE_SECONDS || 5);
const gifSeconds = Number(process.env.SNAPORA_GIF_SECONDS || 3);
const audioMode = process.env.SNAPORA_SMOKE_AUDIO || 'none';
const deadline = setTimeout(
  () => {
    console.error('RECORDING_SMOKE_TIMEOUT');
    manager?.dispose();
    app.exit(1);
  },
  (seconds + gifSeconds + 100) * 1000
);
async function wait(check, label, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}
app.whenReady().then(async () => {
  try {
    const display = screen.getPrimaryDisplay();
    const fixture = new BrowserWindow({
      x: display.bounds.x + 30,
      y: display.bounds.y + 70,
      width: 700,
      height: 420,
      frame: false,
      webPreferences: { backgroundThrottling: false },
    });
    // Keep user windows out of the test pixels, below Snapora's screen-saver-level controls.
    fixture.setAlwaysOnTop(true, 'pop-up-menu');
    const html = join(directory, 'fixture.html');
    writeFileSync(
      html,
      '<html><body style="background:#204a72;color:white;font:48px sans-serif"><h1>Snapora recording</h1><div id="time"></div><script>setInterval(()=>{document.getElementById("time").textContent=new Date().toISOString()},50)</script></body></html>'
    );
    await fixture.loadFile(html);
    manager = new ScreenshotManager();
    const results = [];
    for (const format of ['mp4', 'gif']) {
      let overlay;
      const onReady = (event) => {
        overlay = BrowserWindow.fromWebContents(event.sender);
      };
      ipcMain.on(OVERLAY_CHANNELS.selectionReady, onReady);
      const resultPromise =
        format === 'mp4'
          ? manager.record({
              display: String(display.id),
              locale: 'zh-CN',
              recording: { maxMp4DurationSeconds: seconds, audio: audioMode },
            })
          : manager.capture({
              display: String(display.id),
              locale: 'zh-CN',
              interactionMode: 'live',
              recording: { format: 'gif' },
            });
      await wait(() => overlay, 'selection window');
      if (format === 'gif')
        await js(overlay, 'document.querySelector("[data-mode=record]").click()');
      assert.equal(
        await js(
          overlay,
          'document.querySelector("[data-mode=record]").getAttribute("aria-pressed")'
        ),
        'true'
      );
      overlay.webContents.sendInputEvent({
        type: 'mouseDown',
        x: 50,
        y: 90,
        button: 'left',
        clickCount: 1,
      });
      overlay.webContents.sendInputEvent({
        type: 'mouseMove',
        x: 650,
        y: 410,
        movementX: 600,
        movementY: 320,
      });
      overlay.webContents.sendInputEvent({
        type: 'mouseUp',
        x: 650,
        y: 410,
        button: 'left',
        clickCount: 1,
      });
      const recorder = await wait(
        () =>
          BrowserWindow.getAllWindows().find((win) =>
            win.webContents.getURL().includes('recording.html')
          ),
        'recording window'
      );
      recorder.webContents.on('console-message', (_event, ...args) =>
        console.log('[recorder]', ...args)
      );
      await wait(
        () =>
          js(
            recorder,
            'document.getElementById("dimensions").textContent && !document.getElementById("start").disabled'
          ),
        'recorder init'
      );
      await wait(() => js(recorder, '!document.getElementById("start").disabled'));
      await js(recorder, 'document.getElementById("start").click()');
      await wait(async () => {
        if (recorder.isDestroyed())
          throw new Error(`Recorder failed: ${JSON.stringify(await resultPromise)}`);
        return js(recorder, '!document.getElementById("active").hidden');
      }, 'recording active');
      const memory = [];
      const sampler = setInterval(() => {
        memory.push({
          time: Date.now(),
          processes: app
            .getAppMetrics()
            .map((p) => ({ type: p.type, workingSetSize: p.memory.workingSetSize })),
        });
      }, 1000);
      if (format === 'mp4') {
        const indicator = await js(
          recorder,
          `(() => {
          const dot = document.querySelector('.record-dot'), timer = document.getElementById('timer');
          const a = dot.getBoundingClientRect(), b = timer.getBoundingClientRect();
          return { delta: Math.abs(a.y + a.height/2 - b.y - b.height/2), animation: getComputedStyle(dot).animationName };
        })()`
        );
        assert.ok(
          indicator.delta <= 1.1,
          'recording dot must align with the timer with at most one DIP optical compensation'
        );
        assert.equal(indicator.animation, 'recording-breathe');
        writeFileSync(
          join(directory, 'active.png'),
          (await recorder.webContents.capturePage()).toPNG()
        );
        if (process.platform === 'win32') {
          const b = recorder.getBounds();
          await js(recorder, 'window.snaporaRecording.request("bar-drag")');
          await js(
            recorder,
            `window.snaporaRecording.request("bar-move", ${JSON.stringify({
              dx: display.bounds.x + 150 - b.x,
              dy: display.bounds.y + 330 - b.y,
            })})`
          );
          assert.equal(recorder.getBounds().y, display.bounds.y + 330);
        }
        await pause(1000);
        await js(recorder, 'document.getElementById("pause").click()');
        assert.equal(
          await js(
            recorder,
            'getComputedStyle(document.querySelector(".record-dot")).animationName'
          ),
          'none'
        );
        const before = await js(
          recorder,
          'document.getElementById("timer").textContent'
        );
        await pause(1400);
        assert.equal(
          await js(recorder, 'document.getElementById("timer").textContent'),
          before
        );
        await js(recorder, 'document.getElementById("pause").click()');
      } else {
        await pause(gifSeconds * 1000);
        if (gifSeconds < 60)
          await js(recorder, 'document.getElementById("stop").click()');
      }
      await wait(
        async () => {
          if (recorder.isDestroyed())
            throw new Error(`Recorder failed: ${JSON.stringify(await resultPromise)}`);
          return BrowserWindow.getAllWindows().find(
            (w) =>
              w.webContents.getURL().includes('recording-preview.html') && w.isVisible()
          );
        },
        'recording preview',
        (seconds + 30) * 1000
      );
      clearInterval(sampler);
      const previewWindow = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('recording-preview.html')
      );
      await wait(
        () => js(previewWindow, 'document.getElementById("save").textContent'),
        'preview ready'
      );
      const preview = await js(
        previewWindow,
        `document.getElementById('${format === 'mp4' ? 'video' : 'gif'}').src`
      );
      const tempPath = fileURLToPath(preview);
      const bytes = readFileSync(tempPath);
      assert.ok(bytes.length > 1000);
      if (format === 'gif') assert.equal(bytes.subarray(0, 6).toString(), 'GIF89a');
      else {
        assert.ok(
          bytes.includes(Buffer.from('ftyp')) && bytes.includes(Buffer.from('moof'))
        );
        await wait(
          () => js(previewWindow, 'document.getElementById("video").videoWidth > 0'),
          'MP4 decode'
        );
        const dimensions = await js(
          previewWindow,
          '({width:document.getElementById("video").videoWidth,height:document.getElementById("video").videoHeight})'
        );
        assert.equal(dimensions.width, Math.floor((600 * display.scaleFactor) / 2) * 2);
        const corners = await js(
          previewWindow,
          `new Promise((resolve) => {
          const video = document.getElementById('video');
          video.addEventListener('seeked', () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(video, 0, 0);
            resolve([[0,0], [canvas.width-1,0], [0,canvas.height-1], [canvas.width-1,canvas.height-1], [Math.round(canvas.width * 200/600), Math.round(canvas.height * 265/320)]]
              .map(([x,y]) => Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3)));
          }, { once: true });
          video.currentTime = 0.5;
        })`
        );
        // GPU video-to-canvas readback may use a different color conversion than file decoders.
        // The blue fixture must not gain coral outline pixels or black exclusion rectangles.
        for (const [r, g, b] of corners) {
          assert.ok(
            !(r > g * 1.3 && r > b * 1.3),
            `outline leaked into recorded edge: ${r},${g},${b}`
          );
          assert.ok(r + g + b > 50, 'recording edge must not be blacked out');
        }
        const [r, g, b] = corners.at(-1);
        assert.ok(
          b > r * 1.4 && b > g * 1.1,
          `toolbar must not cover the blue recorded fixture: ${r},${g},${b}`
        );
      }
      const output = join(directory, `result.${format}`);
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
      await js(previewWindow, 'document.getElementById("save").click()');
      const result = await resultPromise;
      dialog.showSaveDialog = original;
      assert.equal(result.status, 'recorded');
      assert.equal(existsSync(tempPath), false);
      assert.equal(manager.activeJobId, undefined);
      results.push({ ...result, memory });
      ipcMain.removeListener(OVERLAY_CHANNELS.selectionReady, onReady);
    }
    writeFileSync(join(directory, 'results.json'), JSON.stringify(results, null, 2));
    console.log(
      'RECORDING_SMOKE_OK',
      directory,
      results.map(({ memory, ...result }) => ({ ...result, samples: memory.length }))
    );
    manager.dispose();
    fixture.destroy();
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(error);
    manager?.dispose();
    clearTimeout(deadline);
    app.exit(1);
  }
});
