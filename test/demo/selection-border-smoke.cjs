/** 验证真实 CSS 在全屏与 DPI 取整裁剪时的边线；只渲染隐藏的合成图片，不采集桌面。 */
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const {
  OVERLAY_CHANNELS,
  SCREENSHOT_PROTOCOL_VERSION,
} = require('electron-snapora/main');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-selection-border-')));
app.commandLine.appendSwitch(
  'force-device-scale-factor',
  process.argv.includes('--fractional') ? '1.5' : '1'
);
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => app.exit(1), 15000);
let overlay;

app.whenReady().then(async () => {
  try {
    let ready;
    const loaded = new Promise((resolve) => {
      ready = resolve;
    });
    ipcMain.once(OVERLAY_CHANNELS.ready, () => ready());
    overlay = new BrowserWindow({
      width: 800,
      height: 600,
      frame: false,
      useContentSize: true,
      thickFrame: false,
      roundedCorners: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../../dist/overlay/preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    await overlay.loadFile(join(__dirname, '../../dist/overlay/index.html'));
    await loaded;
    const viewport = await overlay.webContents.executeJavaScript(
      `({ width: innerWidth, height: innerHeight })`
    );
    const prepared = new Promise((resolve) =>
      ipcMain.once(OVERLAY_CHANNELS.prepared, resolve)
    );
    overlay.webContents.send(OVERLAY_CHANNELS.initialize, {
      protocolVersion: SCREENSHOT_PROTOCOL_VERSION,
      jobId: 'border',
      options: {},
      initialSelection: { x: 0, y: 0, ...viewport },
      frames: [
        {
          display: {
            id: 'synthetic',
            bounds: { x: 0, y: 0, width: 800, height: 600 },
            scaleFactor: 1,
          },
          pixelSize: { width: 800, height: 600 },
          dataUrl: nativeImage
            .createFromBitmap(Buffer.alloc(800 * 600 * 4, 255), {
              width: 800,
              height: 600,
            })
            .toDataURL(),
        },
      ],
    });
    await prepared;
    for (const target of ['.selection', '.window-snap-preview']) {
      // 使用实际两种边框样式，排除尺寸提示/工具栏对边缘像素采样的覆盖。
      await overlay.webContents.executeJavaScript(`(() => {
        document.querySelector('.selection-toolbar').hidden = true;
        document.querySelectorAll('.resize-handle,.size-hint').forEach(e => e.style.display = 'none');
        document.querySelector('.selection').hidden = ${target !== '.selection'};
        const preview = document.querySelector('.window-snap-preview');
        preview.hidden = ${target !== '.window-snap-preview'};
        preview.style.width = innerWidth + 'px'; preview.style.height = innerHeight + 'px';
      })()`);
      await overlay.webContents.executeJavaScript(
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
      );
      const frame = await overlay.webContents.capturePage();
      const { width, height } = frame.getSize();
      const pixels = frame.toBitmap();
      // Windows 位图为 BGRA；裁掉右/底一像素模拟物理屏幕小于取整后 DIP 窗口。
      for (const clip of [0, 1]) {
        const points = [
          [0, height / 2],
          [width - 1 - clip, height / 2],
          [width / 2, 0],
          [width / 2, height - 1 - clip],
        ];
        for (const [x, y] of points) {
          const i = (Math.floor(y) * width + Math.floor(x)) * 4;
          const [b, g, r] = pixels.subarray(i, i + 3);
          assert.ok(
            b > 200 && g > 80 && g < 190 && r < 70,
            `${target}: missing blue edge at ${x},${y}: ${r},${g},${b}`
          );
        }
      }
    }
    assert.equal(overlay.isVisible(), false);
    console.log(
      'PASS: full-screen selection and hover preview retain all four blue edges, including one-pixel screen clipping.'
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    overlay?.destroy();
    app.exit(process.exitCode || 0);
  }
});
