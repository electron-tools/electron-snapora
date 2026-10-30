/** Verify actual desktop-stream pixels with a visible protected overlay on every connected display. */
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, screen, nativeImage } = require('electron');
const { ElectronCaptureAdapter } = require('electron-snapora/main');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-exclusion-')));
app.on('window-all-closed', () => {});
const owned = new Set();
const deadline = setTimeout(() => {
  console.error('Exclusion test timed out');
  app.exit(1);
}, 45_000);

async function pixels(window, frame, point) {
  return window.webContents.executeJavaScript(`(async () => {
    const frame = ${JSON.stringify(frame)};
    const stream = await navigator.mediaDevices.getUserMedia({ audio:false, video:{cursor:'never',mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:frame.sourceId,maxWidth:frame.pixelSize.width,maxHeight:frame.pixelSize.height}} });
    const video = document.createElement('video'); video.muted=true; video.srcObject=stream;
    try {
      await video.play();
      await new Promise(resolve=>video.requestVideoFrameCallback(resolve));
      const canvas=document.createElement('canvas'); canvas.width=video.videoWidth; canvas.height=video.videoHeight;
      const context=canvas.getContext('2d'); context.drawImage(video,0,0);
      const x=Math.round(${point.x}*canvas.width/frame.display.bounds.width), y=Math.round(${point.y}*canvas.height/frame.display.bounds.height);
      return [...context.getImageData(x,y,1,1).data];
    } finally { stream.getTracks().forEach(track=>track.stop()); video.srcObject=null; }
  })()`);
}

app
  .whenReady()
  .then(async () => {
    const adapter = new ElectronCaptureAdapter();
    const evidence = [];
    try {
      for (const display of screen.getAllDisplays()) {
        console.log('display', display.id, display.bounds);
        const { x, y } = display.bounds;
        const base = new BrowserWindow({
          x: x + 80,
          y: y + 80,
          width: 480,
          height: 320,
          frame: false,
          show: false,
          alwaysOnTop: true,
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        owned.add(base);
        await base.loadFile(join(__dirname, 'capture-exclusion.html'));
        base.show();
        await base.webContents.executeJavaScript(
          'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
        );
        const [frame] = await adapter.capture({ display: String(display.id) });
        assert.equal(frame.kind, 'desktop-source');
        const point = {
          x: base.getBounds().x - x + 120,
          y: base.getBounds().y - y + 120,
        };
        console.log('baseline start');
        let baseline = await pixels(base, frame, point);
        for (let i = 0; i < 8 && Math.abs(baseline[1] - 180) >= 12; i++)
          baseline = await pixels(base, frame, point);
        assert.ok(
          Math.abs(baseline[1] - 180) < 12,
          'Fixture must be visible in the baseline'
        );
        for (const protectedWindow of [false, true, true, true]) {
          const overlay = new BrowserWindow({
            ...display.bounds,
            frame: false,
            transparent: true,
            show: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            webPreferences: {
              contextIsolation: true,
              sandbox: true,
              backgroundThrottling: false,
            },
          });
          owned.add(overlay);
          overlay.setContentProtection(protectedWindow);
          await overlay.loadFile(join(__dirname, 'capture-exclusion.html'));
          await overlay.webContents.executeJavaScript(
            "document.documentElement.style.background='transparent';document.body.style.background='rgba(240,20,80,0.8)'"
          );
          overlay.showInactive();
          overlay.setBounds(display.bounds);
          overlay.moveTop();
          // Intentionally no sleep after showing: cover the rapid-selection path too.
          console.log('overlay capture', protectedWindow);
          let actual = await pixels(base, frame, point);
          // The unprotected control must finish its native window-show animation before comparison.
          for (
            let i = 0;
            !protectedWindow && i < 8 && !(actual[0] > 150 && actual[1] < 90);
            i++
          )
            actual = await pixels(base, frame, point);
          // WGC can be denied in elevated hosts; validate the image fallback with the same visible UI.
          const [fallback] = await adapter.captureFallback({}, frame.display);
          const image = nativeImage.createFromDataURL(fallback.dataUrl);
          const size = image.getSize();
          const bgra = image
            .crop({
              x: Math.round((point.x * size.width) / display.bounds.width),
              y: Math.round((point.y * size.height) / display.bounds.height),
              width: 1,
              height: 1,
            })
            .toBitmap();
          const fallbackActual = [bgra[2], bgra[1], bgra[0], bgra[3]];
          const [liveFrame] = await adapter.capture(
            { interactionMode: 'live' },
            frame.display
          );
          const liveImage = nativeImage.createFromDataURL(liveFrame.dataUrl);
          const liveSize = liveImage.getSize();
          const liveBgra = liveImage
            .crop({
              x: Math.round((point.x * liveSize.width) / display.bounds.width),
              y: Math.round((point.y * liveSize.height) / display.bounds.height),
              width: 1,
              height: 1,
            })
            .toBitmap();
          const nativeActual = [liveBgra[2], liveBgra[1], liveBgra[0], liveBgra[3]];
          if (protectedWindow)
            baseline.forEach((value, index) => {
              assert.ok(
                Math.abs(actual[index] - value) <= 4,
                `Overlay leaked on display ${display.id}: ${actual}`
              );
              assert.ok(
                Math.abs(fallbackActual[index] - value) <= 4,
                `Fallback overlay leaked on display ${display.id}: ${fallbackActual}`
              );
              assert.ok(
                Math.abs(nativeActual[index] - value) <= 4,
                `Native live overlay leaked on display ${display.id}: ${nativeActual}`
              );
            });
          else {
            assert.ok(
              actual[0] > 150 && actual[1] < 90,
              `Unprotected control was not captured: ${actual}`
            );
            assert.ok(fallbackActual[0] > 150 && fallbackActual[1] < 90);
            assert.ok(nativeActual[0] > 150 && nativeActual[1] < 90);
          }
          evidence.push({
            displayId: display.id,
            scaleFactor: display.scaleFactor,
            protectedWindow,
            baseline,
            actual,
            fallbackActual,
            nativeActual,
          });
          overlay.destroy();
          owned.delete(overlay);
        }
        base.destroy();
        owned.delete(base);
      }
      const directory = join(__dirname, '../../.pack-preview');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'capture-exclusion.json'),
        JSON.stringify({ electron: process.versions.electron, evidence }, null, 2)
      );
      console.log(
        JSON.stringify({ electron: process.versions.electron, evidence }, null, 2)
      );
    } finally {
      adapter.dispose();
      for (const window of owned) if (!window.isDestroyed()) window.destroy();
      clearTimeout(deadline);
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
