// Run after build:overlay: electron demo/tooltip-smoke.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
let exitCode = 0;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'snapora-tooltip-'));
const preload = path.join(temporaryDirectory, 'preload.cjs');
fs.writeFileSync(
  preload,
  `require('electron').contextBridge.exposeInMainWorld('snaporaOverlay', {
    onInitialize() {}, onFeedback() {}, ready() {}
  });`
);

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      webPreferences: { preload },
    });
    window.webContents.on('console-message', (_event, details) => {
      if (details.level === 'error') console.error(details.message);
    });
    try {
      await window.loadFile(path.join(__dirname, '../dist/overlay/index.html'));
      const result = await window.webContents.executeJavaScript(`(async () => {
      const toolbar = document.querySelector('.selection-toolbar');
      toolbar.hidden = false;
      toolbar.style.visibility = 'visible';
      const buttons = [...toolbar.querySelectorAll('[data-tooltip]')].filter(button => button.getClientRects().length);
      const shortcuts = ['save', 'cancel', 'confirm'].map(name =>
        document.querySelector('.' + name + '-button').hasAttribute('data-shortcut'));
      const failures = [];
      let checked = 0;
      for (const direction of ['above', 'below']) {
        toolbar.dataset.tooltipPlacement = direction;
        for (const side of ['left', 'right']) {
          const x = side === 'left' ? 8 : innerWidth - toolbar.offsetWidth - 8;
          toolbar.style.transform = 'translate(' + x + 'px, 300px)';
          for (const button of buttons) {
            button.disabled = false;
            const originalLabel = button.dataset.tooltip;
            for (const label of [originalLabel, '完成', 'Localized tooltip '.repeat(20)]) {
              button.dataset.tooltip = label;
              button.blur();
              button.focus();
              button.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
              await new Promise(resolve => requestAnimationFrame(resolve));
              const bubble = getComputedStyle(button, '::after');
              const bounds = button.getBoundingClientRect();
              const width = parseFloat(bubble.width);
              const left = bounds.left + button.clientLeft + parseFloat(bubble.left) - width / 2;
              const right = left + width;
              checked++;
              if (!Number.isFinite(left) || left < 7 || right > innerWidth - 7) {
                failures.push({ direction, side, label, left, right, width });
              }
            }
            button.dataset.tooltip = originalLabel;
          }
        }
      }
      return { checked, failures, shortcuts };
    })()`);
      assert.deepEqual(result.shortcuts, [false, false, false]);
      assert.equal(
        result.failures.length,
        0,
        JSON.stringify(result.failures.slice(0, 3))
      );
      assert.ok(result.checked > 0);
      console.log(`Tooltip Electron geometry checks passed: ${result.checked} cases.`);
    } finally {
      window.destroy();
    }
  })
  .catch((error) => {
    console.error(error);
    exitCode = 1;
  })
  .finally(() => {
    fs.unlinkSync(preload);
    fs.rmdirSync(temporaryDirectory);
    app.exit(exitCode);
  });
