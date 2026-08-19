const { app, BrowserWindow } = require('electron');
const { DEFAULT_SCREENSHOT_RESOURCE_LIMITS } = require('electron-snapora/main');

app.disableHardwareAcceleration();

const stressTimeout = setTimeout(() => {
  console.error('Electron Snapora 4K stress test timed out.');
  process.exit(2);
}, 60_000);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await window.loadURL('data:text/html,<html><body></body></html>');
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const width = 3840;
      const height = 2160;
      const startedAt = performance.now();
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      const imageData = context.createImageData(width, height);
      let random = 0x12345678;
      for (let offset = 0; offset < imageData.data.length; offset += 4) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        imageData.data[offset] = random & 0xff;
        imageData.data[offset + 1] = (random >>> 8) & 0xff;
        imageData.data[offset + 2] = (random >>> 16) & 0xff;
        imageData.data[offset + 3] = 0xff;
      }
      context.putImageData(imageData, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return {
        width,
        height,
        outputBytes: blob.size,
        exportMs: Math.round((performance.now() - startedAt) * 100) / 100,
      };
    })()
  `);
  const peakWorkingSetKb = app
    .getAppMetrics()
    .reduce((total, metric) => total + (metric.memory?.peakWorkingSetSize ?? 0), 0);
  window.destroy();
  clearTimeout(stressTimeout);

  if (
    result.width * result.height >
      DEFAULT_SCREENSHOT_RESOURCE_LIMITS.maxCapturePixels ||
    result.outputBytes > DEFAULT_SCREENSHOT_RESOURCE_LIMITS.maxOutputBytes
  ) {
    throw new Error(
      `4K stress output exceeded default limits: ${JSON.stringify(result)}`
    );
  }

  console.log(
    `Electron Snapora 4K stress passed: ${JSON.stringify({
      ...result,
      peakWorkingSetMb: Math.round((peakWorkingSetKb / 1024) * 100) / 100,
    })}`
  );
  app.quit();
});
