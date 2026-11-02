/** Real capture/encode test with deterministic media inputs; optional real device probe. */
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  dialog,
  nativeTheme,
} = require('electron');
let deviceMenu;
const findDeviceMenu = () =>
  BrowserWindow.getAllWindows().find(
    (w) => w.webContents.getURL().includes('recording-devices.html') && w.isVisible()
  );
const { ScreenshotManager, OVERLAY_CHANNELS } = require('../../dist/main/index.cjs');
const dir = mkdtempSync(join(tmpdir(), 'snapora-media-'));
const real = process.env.SNAPORA_MEDIA_REAL === '1';
app.setPath('userData', join(dir, 'profile'));
if (!real) {
  // 660 Hz microphone signal and a solid magenta camera make the encoded result measurable.
  const wav = Buffer.alloc(44 + 48000 * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(96000, 40);
  for (let i = 0; i < 48000; i++)
    wav.writeInt16LE(
      Math.round(3500 * Math.sin((2 * Math.PI * 660 * i) / 48000)),
      44 + 2 * i
    );
  const wavPath = join(dir, 'mic.wav');
  writeFileSync(wavPath, wav);
  const y4m = join(dir, 'camera.y4m');
  writeFileSync(
    y4m,
    Buffer.concat([
      Buffer.from('YUV4MPEG2 W320 H180 F30:1 Ip A1:1 C420jpeg\nFRAME\n'),
      Buffer.alloc(320 * 180, 106),
      Buffer.alloc(160 * 90, 202),
      Buffer.alloc(160 * 90, 222),
    ])
  );
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-video-capture', y4m);
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', wavPath);
}
app.on('window-all-closed', () => {});
let manager;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn) {
  for (let i = 0; i < 250; i++) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw new Error('Media test timed out');
}
const js = (win, code) => win.webContents.executeJavaScript(code, true);
const timeout = setTimeout(() => {
  manager?.dispose();
  app.exit(1);
}, 90000);
app.whenReady().then(async () => {
  try {
    const display = screen.getPrimaryDisplay();
    const fixture = new BrowserWindow({
      x: display.bounds.x + 20,
      y: display.bounds.y + 60,
      width: 760,
      height: 460,
      frame: false,
      webPreferences: { backgroundThrottling: false },
    });
    fixture.setAlwaysOnTop(true, 'pop-up-menu');
    const html = join(dir, 'fixture.html');
    writeFileSync(
      html,
      '<body style="margin:0;background:#204a72;height:100vh"></body>'
    );
    await fixture.loadFile(html);
    // Play a quiet 440 Hz tone into actual system loopback, independent of the fake microphone.
    await js(
      fixture,
      `window.ctx=new AudioContext(); const oscillator=ctx.createOscillator(); oscillator.frequency.value=440; const gain=ctx.createGain(); gain.gain.value=.025; oscillator.connect(gain).connect(ctx.destination); oscillator.start(); ctx.resume(); true`
    );
    manager = new ScreenshotManager();
    let selected;
    ipcMain.on(OVERLAY_CHANNELS.selectionReady, (event, payload) => {
      selected = {
        win: BrowserWindow.fromWebContents(event.sender),
        jobId: payload.jobId,
      };
    });
    const resultPromise = manager.record({
      display: String(display.id),
      locale: process.env.SNAPORA_SMOKE_LOCALE || 'zh-CN',
      recording: { maxMp4DurationSeconds: 6, audio: real ? 'system' : 'both' },
    });
    await wait(() => selected);
    await js(
      selected.win,
      `window.snaporaOverlay.selected(${JSON.stringify({ jobId: selected.jobId, displayId: String(display.id), selection: { x: 50, y: 100, width: 600, height: 300 } })})`
    );
    const recorder = await wait(() =>
      BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('recording.html')
      )
    );
    await wait(() =>
      js(
        recorder,
        'document.getElementById("dimensions").textContent && !document.getElementById("start").disabled'
      )
    );
    assert.equal(await js(recorder, '!document.getElementById("cancel")'), true);
    nativeTheme.themeSource = 'dark';
    const preparationBounds = recorder.getBounds();
    const preparationHeight = await js(
      recorder,
      'document.querySelector("main").getBoundingClientRect().height'
    );
    if (!real) {
      // Exercise recoverable failures with long native messages, not only the happy path.
      for (const name of ['NotAllowedError', 'NotFoundError', 'Error']) {
        await js(
          recorder,
          `(() => {
          const original = navigator.mediaDevices.enumerateDevices;
          navigator.mediaDevices.enumerateDevices = async () => {
            navigator.mediaDevices.enumerateDevices = original;
            throw new DOMException('diagnostic-detail-'.repeat(100), ${JSON.stringify(name)});
          };
          document.getElementById('microphone-menu').click();
        })()`
        );
        await wait(() =>
          js(recorder, '!document.getElementById("prepare-error").hidden')
        );
        const errorState = await js(
          recorder,
          `({
          message: document.getElementById('prepare-error-text').textContent,
          status: document.getElementById('status').textContent,
          height: document.querySelector('main').getBoundingClientRect().height,
          fits: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth,
          textFits: document.getElementById('prepare-error-text').getBoundingClientRect().height <= 28
        })`
        );
        assert.ok(!errorState.message.includes('diagnostic-detail'));
        assert.equal(
          /denied|被拒绝/.test(errorState.message),
          name === 'NotAllowedError'
        );
        assert.equal(errorState.status, '');
        assert.equal(errorState.height, preparationHeight);
        assert.ok(errorState.fits && errorState.textFits);
        assert.deepEqual(recorder.getBounds(), preparationBounds);
        writeFileSync(
          join(dir, `device-error-${name}.png`),
          (await recorder.webContents.capturePage()).toPNG()
        );
        // Retrying device enumeration clears its previous error without resizing.
        await js(recorder, 'document.getElementById("microphone-menu").click()');
        await wait(findDeviceMenu);
        assert.equal(
          await js(recorder, 'document.getElementById("prepare-error").hidden'),
          true
        );
        await js(recorder, 'window.snaporaRecording.request("device-menu-close")');
        await wait(() =>
          js(
            recorder,
            'document.getElementById("microphone-menu").getAttribute("aria-expanded")==="false"'
          )
        );
      }
      if (process.platform === 'win32') {
        await js(
          recorder,
          `(() => {
          const original = navigator.mediaDevices.getDisplayMedia;
          navigator.mediaDevices.getDisplayMedia = async () => {
            navigator.mediaDevices.getDisplayMedia = original;
            throw new Error('Screen capture initialization failed');
          };
          document.querySelector('input[value="gif"]').click();
        })()`
        );
        await wait(() =>
          js(recorder, '!document.getElementById("prepare-error").hidden')
        );
        assert.equal(
          await js(
            recorder,
            '/denied|被拒绝/.test(document.getElementById("prepare-error-text").textContent)'
          ),
          false
        );
        await js(recorder, 'document.getElementById("prepare-error-action").click()');
        await wait(() =>
          js(
            recorder,
            'document.getElementById("prepare-error").hidden && document.getElementById("start").getAttribute("aria-busy")==="false"'
          )
        );
        await js(recorder, 'document.querySelector(\'input[value="mp4"]\').click()');
        await wait(() =>
          js(
            recorder,
            'document.getElementById("prepare-error").hidden && document.getElementById("start").getAttribute("aria-busy")==="false"'
          )
        );
        assert.deepEqual(recorder.getBounds(), preparationBounds);
      }
    }
    let preparationResizes = 0;
    const resized = () => preparationResizes++;
    recorder.on('resize', resized);
    const initialStartText = await js(
      recorder,
      'document.getElementById("start").textContent'
    );
    for (let i = 0; i < 3; i++) {
      deviceMenu = undefined;
      await js(recorder, 'document.getElementById("microphone-menu").click()');
      deviceMenu = await wait(findDeviceMenu);
      await sleep(120);
      assert.equal(
        await js(
          deviceMenu,
          'getComputedStyle(document.querySelector("main")).backgroundColor'
        ),
        'rgb(255, 255, 255)'
      );
      assert.equal(
        nativeTheme.themeSource,
        'dark',
        'menu must not override the host theme'
      );
      if (i === 0)
        writeFileSync(
          join(dir, 'device-dropdown.png'),
          (await deviceMenu.webContents.capturePage()).toPNG()
        );
      assert.deepEqual(
        recorder.getBounds(),
        preparationBounds,
        'opening menu must not resize or recenter preparation'
      );
      assert.equal(
        await js(
          recorder,
          'document.querySelector("main").getBoundingClientRect().height'
        ),
        preparationHeight
      );
      assert.equal(
        await js(recorder, 'document.getElementById("start").textContent'),
        initialStartText,
        'menu opening must not restart preparation'
      );
      await js(recorder, 'window.snaporaRecording.request("device-menu-close")');
      await wait(() =>
        js(
          recorder,
          'document.getElementById("microphone-menu").getAttribute("aria-expanded")==="false"'
        )
      );
    }
    deviceMenu = undefined;
    await js(recorder, 'document.getElementById("microphone-menu").click()');
    deviceMenu = await wait(findDeviceMenu);
    const microphones = await js(
      deviceMenu,
      '[...document.querySelectorAll("button")].map(b=>({id:b.dataset.deviceId,label:b.textContent}))'
    );
    console.log(
      'MICROPHONES',
      microphones.map((d) => d.label)
    );
    if (real && microphones.length < 2) {
      manager.cancel();
      await resultPromise;
      console.log('REAL_MEDIA_UNAVAILABLE: microphone');
      app.exit(0);
      return;
    }
    assert.ok(microphones.length > 1, 'microphone picker must list a concrete device');
    await js(deviceMenu, 'document.querySelectorAll("button")[1].click()');
    await wait(() =>
      js(
        recorder,
        'document.getElementById("microphone-menu").getAttribute("aria-expanded")==="false"'
      )
    );
    deviceMenu = undefined;
    await js(recorder, 'document.getElementById("camera-menu").click()');
    deviceMenu = await wait(findDeviceMenu);
    const cameras = await js(
      deviceMenu,
      '[...document.querySelectorAll("button")].map(b=>({id:b.dataset.deviceId,label:b.textContent}))'
    );
    console.log(
      'CAMERAS',
      cameras.map((d) => d.label)
    );
    if (real && cameras.length < 2) {
      manager.cancel();
      await resultPromise;
      console.log('REAL_MEDIA_UNAVAILABLE: camera');
      app.exit(0);
      return;
    }
    assert.ok(cameras.length > 1, 'camera picker must list a concrete device');
    await js(deviceMenu, 'document.querySelectorAll("button")[1].click()');
    await wait(() =>
      js(
        recorder,
        'document.getElementById("camera-menu").getAttribute("aria-expanded")==="false"'
      )
    );
    assert.deepEqual(recorder.getBounds(), preparationBounds);
    assert.equal(preparationResizes, 0, 'device selection must not resize preparation');
    deviceMenu = undefined;
    await js(recorder, 'document.getElementById("microphone-menu").click()');
    deviceMenu = await wait(findDeviceMenu);
    assert.equal(
      await js(
        deviceMenu,
        'document.querySelectorAll("button")[1].getAttribute("aria-checked")==="true"'
      ),
      true,
      'chosen input must be marked when reopening'
    );
    await js(recorder, 'window.snaporaRecording.request("device-menu-close")');
    await wait(() =>
      js(
        recorder,
        'document.getElementById("microphone-menu").getAttribute("aria-expanded")==="false"'
      )
    );
    assert.equal(preparationResizes, 0);
    recorder.removeListener('resize', resized);
    await js(recorder, 'document.getElementById("camera").click()');
    await wait(() =>
      js(
        recorder,
        'document.getElementById("camera").getAttribute("aria-pressed")==="true"'
      )
    );
    const camera = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('camera.html')
    );
    assert.ok(camera.isVisible());
    assert.equal(
      await js(
        camera,
        'window.snaporaRecording.request("begin",{}).then(()=>false,()=>true)'
      ),
      true,
      'camera cannot invoke recorder writes or begin'
    );
    writeFileSync(
      join(dir, 'preparation.png'),
      (await recorder.webContents.capturePage()).toPNG()
    );
    camera.webContents.sendInputEvent({ type: 'mouseMove', x: 30, y: 30 });
    const cameraControls = await wait(() =>
      BrowserWindow.getAllWindows().find(
        (w) => w.webContents.getURL().includes('camera-controls.html') && w.isVisible()
      )
    );
    assert.ok(cameraControls.isContentProtected());
    assert.deepEqual(
      cameraControls.getBounds(),
      camera.getBounds(),
      'settings overlay must stay inside the camera window'
    );
    const english = process.env.SNAPORA_SMOKE_LOCALE === 'en';
    await wait(() =>
      js(cameraControls, 'document.querySelector("[data-size=medium]").dataset.tooltip')
    );
    assert.deepEqual(
      await js(
        cameraControls,
        `[...document.querySelectorAll('button')].map(b=>({tooltip:b.dataset.tooltip,title:b.hasAttribute('title')}))`
      ),
      (english
        ? ['Rectangle (16:9)', 'Square', 'Circle', 'Small', 'Medium', 'Large']
        : ['长方形（16:9）', '正方形', '圆形', '小尺寸', '中尺寸', '大尺寸']
      ).map((tooltip) => ({ tooltip, title: false }))
    );
    await wait(() =>
      js(
        cameraControls,
        'document.querySelector("[data-size=medium]").getAttribute("aria-pressed") === "true"'
      )
    );
    assert.equal(
      await js(
        cameraControls,
        'window.snaporaRecording.request("camera-init").then(()=>false,()=>true)'
      ),
      true,
      'settings window cannot obtain device IDs or camera capture capability'
    );
    for (const shape of ['rectangle', 'square', 'circle']) {
      await js(
        cameraControls,
        `document.querySelector('[data-shape=${shape}]').click()`
      );
      await wait(() => js(camera, `document.body.dataset.shape === '${shape}'`));
      let previousWidth = 0;
      for (const size of ['small', 'medium', 'large']) {
        await wait(() =>
          js(cameraControls, '!document.querySelector("button").disabled')
        );
        await js(
          cameraControls,
          `document.querySelector('[data-size=${size}]').click()`
        );
        await wait(() =>
          js(cameraControls, '!document.querySelector("button").disabled')
        );
        const b = camera.getBounds();
        assert.deepEqual(
          cameraControls.getBounds(),
          b,
          'settings follow every camera size/shape change'
        );
        assert.ok(b.width > previousWidth, 'size presets must remain distinct');
        assert.ok(
          Math.abs(b.width / b.height - (shape === 'rectangle' ? 16 / 9 : 1)) < 0.04
        );
        assert.ok(b.x >= display.bounds.x + 50 && b.y >= display.bounds.y + 100);
        assert.ok(
          b.x + b.width <= display.bounds.x + 650 &&
            b.y + b.height <= display.bounds.y + 400
        );
        previousWidth = b.width;
      }
      writeFileSync(
        join(dir, `camera-${shape}.png`),
        (await camera.webContents.capturePage()).toPNG()
      );
    }
    await js(
      cameraControls,
      'window.snaporaRecording.request("camera-style", {shape:"square",size:"medium"})'
    );
    await js(camera, 'window.snaporaRecording.request("camera-hover",true)');
    cameraControls.focus();
    const dragOrigin = camera.getBounds();
    // Establish the pointer inside this window after native menu focus/capture was released.
    cameraControls.webContents.sendInputEvent({
      type: 'mouseMove',
      x: 30,
      y: 30,
      globalX: dragOrigin.x + 30,
      globalY: dragOrigin.y + 30,
    });
    cameraControls.webContents.sendInputEvent({
      type: 'mouseDown',
      x: 30,
      y: 30,
      globalX: dragOrigin.x + 30,
      globalY: dragOrigin.y + 30,
      button: 'left',
      clickCount: 1,
    });
    await wait(() => js(cameraControls, 'document.body.dataset.dragging === "true"'));
    assert.equal(
      await js(
        cameraControls,
        'getComputedStyle(document.querySelector("main")).visibility'
      ),
      'hidden'
    );
    cameraControls.webContents.sendInputEvent({
      type: 'mouseMove',
      x: 14,
      y: 18,
      movementX: -16,
      movementY: -12,
      globalX: dragOrigin.x + 14,
      globalY: dragOrigin.y + 18,
    });
    await wait(() => camera.getBounds().x < dragOrigin.x).catch(async (error) => {
      console.error('CAMERA_DRAG_DIAGNOSTIC', {
        dragOrigin,
        current: camera.getBounds(),
        focused: BrowserWindow.getFocusedWindow()?.getTitle(),
        dragging: await js(cameraControls, 'document.body.dataset.dragging'),
      });
      throw error;
    });
    assert.equal(
      camera.getBounds().width,
      dragOrigin.width,
      'dragging through the transparent control layer must not resize camera'
    );
    assert.deepEqual(cameraControls.getBounds(), camera.getBounds());
    cameraControls.webContents.sendInputEvent({
      type: 'mouseUp',
      x: 14,
      y: 18,
      button: 'left',
      clickCount: 1,
    });
    await wait(() => js(cameraControls, '!document.body.dataset.dragging'));
    await js(camera, 'window.snaporaRecording.request("camera-drag")');
    await js(
      camera,
      'window.snaporaRecording.request("camera-move", {dx:10000,dy:10000})'
    );
    await js(camera, 'window.snaporaRecording.request("camera-hover",true)');
    // Native window handoff can emit leave without moving the OS cursor. Reproduce it
    // repeatedly: the combined camera/controls hover region must remain visible.
    const getCursor = screen.getCursorScreenPoint;
    let hides = 0;
    const hidden = () => hides++;
    cameraControls.on('hide', hidden);
    try {
      const bounds = camera.getBounds();
      screen.getCursorScreenPoint = () => ({ x: bounds.x + 20, y: bounds.y + 20 });
      for (let i = 0; i < 6; i++) {
        await js(camera, 'window.snaporaRecording.request("camera-hover",true)');
        await js(camera, 'window.snaporaRecording.request("camera-hover",false)');
        await new Promise((r) => setTimeout(r, 120));
        assert(cameraControls.isVisible(), 'window handoff must not hide settings');
      }
      assert.equal(hides, 0, 'hover must not flicker');
      screen.getCursorScreenPoint = () => ({ x: bounds.x - 20, y: bounds.y - 20 });
      await js(
        cameraControls,
        'document.body.dispatchEvent(new PointerEvent("pointerleave"))'
      );
      await wait(() => !cameraControls.isVisible());
    } finally {
      screen.getCursorScreenPoint = getCursor;
      cameraControls.removeListener('hide', hidden);
    }
    await js(camera, 'window.snaporaRecording.request("camera-hover",true)');
    writeFileSync(
      join(dir, 'camera-settings.png'),
      (await cameraControls.webContents.capturePage()).toPNG()
    );
    await js(cameraControls, 'window.snaporaRecording.request("camera-settings-hide")');
    assert.equal(cameraControls.isVisible(), false);
    const first = camera.getBounds();
    assert.equal(first.width, first.height, 'camera window must be square');
    assert.equal(
      await js(
        camera,
        'getComputedStyle(document.querySelector("video")).borderRadius'
      ),
      '12px'
    );
    const cameraImage = await camera.webContents.capturePage();
    assert.equal(
      cameraImage.toBitmap()[3],
      0,
      'rounded camera corners must be transparent'
    );
    writeFileSync(join(dir, 'camera.png'), cameraImage.toPNG());
    camera.focus();
    assert.equal(
      camera.getBounds().width,
      first.width,
      'focusing camera must not resize it'
    );
    await wait(() => js(recorder, '!document.getElementById("start").disabled'));
    await js(recorder, 'document.getElementById("start").click()');
    await wait(() =>
      js(
        recorder,
        `document.getElementById("record-state").textContent===${JSON.stringify(english ? 'Recording' : '录制中')}`
      )
    );
    let chromePoints;
    if (['win32', 'darwin'].includes(process.platform)) {
      await js(camera, 'window.snaporaRecording.request("camera-hover",true)');
      assert.ok(cameraControls.isVisible());
      const hover = await js(
        cameraControls,
        `(()=>{const r=document.querySelector('button').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
      );
      cameraControls.webContents.sendInputEvent({ type: 'mouseMove', ...hover });
      await sleep(600);
      chromePoints = await js(
        cameraControls,
        `(()=>{
        const main=document.querySelector('main').getBoundingClientRect();
        const b=document.querySelector('button'), r=b.getBoundingClientRect(), tip=getComputedStyle(b,'::after');
        return {bar:{x:main.x+main.width/2,y:main.y+main.height/2},tip:{x:r.x+r.width/2+(parseFloat(b.style.getPropertyValue('--tooltip-offset-x'))||0),y:r.y-11-parseFloat(tip.height)/2},opacity:tip.opacity};
      })()`
      );
      assert.equal(
        chromePoints.opacity,
        '1',
        'shared tooltip must appear during hover'
      );
      writeFileSync(
        join(dir, 'camera-hover-tooltip.png'),
        (await cameraControls.webContents.capturePage()).toPNG()
      );
      await sleep(1200);
    } else await sleep(1800);
    await js(camera, 'window.snaporaRecording.request("camera-drag")');
    await js(
      camera,
      'window.snaporaRecording.request("camera-move",{dx:-10000,dy:-10000})'
    );
    const moved = camera.getBounds();
    assert.equal(moved.width, first.width, 'camera drag must preserve width');
    assert.equal(moved.height, first.height, 'camera drag must preserve height');
    assert.equal(moved.x, display.bounds.x + 50);
    assert.equal(moved.y, display.bounds.y + 100);
    await wait(() =>
      BrowserWindow.getAllWindows().find(
        (w) =>
          w.webContents.getURL().includes('recording-preview.html') && w.isVisible()
      )
    );
    const previewWindow = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('recording-preview.html')
    );
    assert.ok(previewWindow?.isVisible(), 'native preview must be visible');
    writeFileSync(
      join(dir, 'preview.png'),
      (await previewWindow.webContents.capturePage()).toPNG()
    );
    assert.ok(camera.isDestroyed(), 'camera must release after encoding');
    const output = join(dir, 'result.mp4');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    await js(previewWindow, 'document.getElementById("save").click()');
    assert.equal((await resultPromise).status, 'recorded');
    if (!real && process.env.SNAPORA_TEST_FFMPEG) {
      const decode = (args) =>
        execFileSync(process.env.SNAPORA_TEST_FFMPEG, ['-v', 'error', ...args], {
          maxBuffer: 20 * 1024 * 1024,
          windowsHide: true,
        });
      const pixels = (t) =>
        decode([
          '-ss',
          String(t),
          '-i',
          output,
          '-frames:v',
          '1',
          '-vf',
          'scale=600:300',
          '-pix_fmt',
          'rgb24',
          '-f',
          'rawvideo',
          'pipe:1',
        ]);
      const early = pixels(0.8),
        late = pixels(4);
      const rgb = (data, x, y) =>
        Array.from(data.subarray((y * 600 + x) * 3, (y * 600 + x) * 3 + 3));
      const magenta = (p) => p[0] > 180 && p[1] < 90 && p[2] > 150;
      assert.ok(
        magenta(rgb(early, 550, 250)) && !magenta(rgb(early, 50, 40)),
        'camera is recorded at initial lower-right position'
      );
      assert.ok(
        magenta(rgb(late, 50, 40)) && !magenta(rgb(late, 550, 250)),
        'camera follows its dragged position in saved video'
      );
      assert.ok(
        !magenta(
          rgb(early, first.x - display.bounds.x - 49, first.y - display.bounds.y - 99)
        ),
        'camera top-left corner must be clipped in the encoded file, not just the DOM'
      );
      assert.ok(
        !magenta(rgb(late, 1, 1)),
        'dragged camera keeps transparent rounded corners in saved video'
      );
      if (chromePoints) {
        for (const p of [chromePoints.bar, chromePoints.tip]) {
          const x = Math.round(first.x - display.bounds.x - 50 + p.x),
            y = Math.round(first.y - display.bounds.y - 100 + p.y);
          assert.ok(
            magenta(rgb(early, x, y)),
            'camera settings/tooltip must be excluded while visibly overlapping the recorded camera'
          );
        }
      }
      const pcm = decode([
        '-ss',
        '1',
        '-i',
        output,
        '-t',
        '1',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-f',
        'f32le',
        'pipe:1',
      ]);
      const samples = Array.from({ length: pcm.length / 4 }, (_, i) =>
        pcm.readFloatLE(i * 4)
      );
      const amplitude = (f) => {
        let re = 0,
          im = 0;
        samples.forEach((v, i) => {
          re += v * Math.cos((2 * Math.PI * f * i) / 48000);
          im += v * Math.sin((2 * Math.PI * f * i) / 48000);
        });
        return (2 * Math.hypot(re, im)) / samples.length;
      };
      const microphone = amplitude(660),
        system = amplitude(440);
      assert.ok(microphone > 0.005, `microphone signal missing: ${microphone}`);
      console.log(
        'FAKE_LOOPBACK_NOTE',
        'Chromium fake media flag also substitutes desktop audio; system loopback is checked separately.'
      );
      console.log('ENCODED_MEDIA_VERIFIED', { microphone, system, first, moved });
    }
    if (real && process.env.SNAPORA_TEST_FFMPEG) {
      const pcm = execFileSync(
        process.env.SNAPORA_TEST_FFMPEG,
        [
          '-v',
          'error',
          '-ss',
          '1',
          '-i',
          output,
          '-t',
          '1',
          '-vn',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-f',
          'f32le',
          'pipe:1',
        ],
        { windowsHide: true }
      );
      let re = 0,
        im = 0;
      const n = pcm.length / 4;
      for (let i = 0; i < n; i++) {
        const v = pcm.readFloatLE(i * 4);
        re += v * Math.cos((2 * Math.PI * 440 * i) / 48000);
        im += v * Math.sin((2 * Math.PI * 440 * i) / 48000);
      }
      const systemSignal = (2 * Math.hypot(re, im)) / n;
      assert.ok(
        systemSignal > 0.001,
        `real system loopback is silent: ${systemSignal}`
      );
      console.log('REAL_SYSTEM_AUDIO_VERIFIED', { systemSignal });
    }
    console.log('MEDIA_SMOKE_OK', dir, { real });
    fixture.destroy();
    manager.dispose();
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error);
    manager?.dispose();
    clearTimeout(timeout);
    app.exit(1);
  }
});
