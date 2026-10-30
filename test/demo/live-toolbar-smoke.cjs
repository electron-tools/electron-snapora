/** Hold real capture behind a barrier to verify immediate toolbar input, hover colors and deferred output. */
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const {
  ScreenshotManager,
  ElectronCaptureAdapter,
  OVERLAY_CHANNELS,
} = require('electron-snapora/main');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'snapora-toolbar-')));
app.on('window-all-closed', () => {});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let manager, adapter, fixture, overlay, release;
let outputCount = 0;
const deadline = setTimeout(() => {
  console.error('Toolbar smoke timed out');
  app.exit(1);
}, 30000);
ipcMain.on(OVERLAY_CHANNELS.selectionReady, (event) => {
  overlay = BrowserWindow.fromWebContents(event.sender);
});
async function waitUntil(predicate) {
  for (let i = 0; i < 250; i++) {
    if (await predicate()) return;
    await pause(20);
  }
  throw new Error('Toolbar did not reach the expected state');
}
const evaluate = (code) => overlay.webContents.executeJavaScript(code);
/** Empty-editor hover must not read layout or toggle cursor DOM on every event. */
async function measureHover(phase) {
  const stats = await evaluate(`(() => {
    let bounds=0,hits=0;const read=Element.prototype.getBoundingClientRect,hit=document.elementFromPoint;
    Element.prototype.getBoundingClientRect=function(...a){bounds++;return read.apply(this,a)};
    document.elementFromPoint=function(...a){hits++;return hit.apply(this,a)};
    const canvas=document.querySelector('.annotation-canvas'),started=performance.now();
    try {for(let i=0;i<1000;i++)canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:200+i%300,clientY:220,buttons:0}));}
    finally{Element.prototype.getBoundingClientRect=read;document.elementFromPoint=hit;}
    return {bounds,hits,ms:performance.now()-started};
  })()`);
  assert.equal(stats.bounds, 0);
  assert.equal(stats.hits, 0);
  console.log('Hover 1000 events', phase, stats);
}
app
  .whenReady()
  .then(async () => {
    try {
      const display = screen.getPrimaryDisplay();
      fixture = new BrowserWindow({
        x: display.bounds.x + 100,
        y: display.bounds.y + 100,
        width: 600,
        height: 400,
        show: false,
      });
      await fixture.loadFile(join(__dirname, 'capture-exclusion.html'));
      fixture.show();
      adapter = new ElectronCaptureAdapter();
      const capture = adapter.capture.bind(adapter);
      let barrier;
      adapter.capture = async (...args) => {
        await barrier;
        return capture(...args);
      };
      manager = new ScreenshotManager({
        captureAdapter: adapter,
        outputAdapter: {
          execute: async () => {
            outputCount++;
            return { status: 'completed', action: 'copy' };
          },
        },
      });
      await manager.prepare({ display: 'primary', interactionMode: 'live' });
      for (const action of ['cancel', 'edit', 'confirm']) {
        barrier = new Promise((resolve) => {
          release = resolve;
        });
        overlay = undefined;
        const result = manager.capture({ display: 'primary', interactionMode: 'live' });
        await waitUntil(() => overlay);
        // Manual selection inside the fixture: no external application input or clipboard writes.
        overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 130, y: 160 });
        overlay.webContents.sendInputEvent({
          type: 'mouseDown',
          button: 'left',
          clickCount: 1,
          x: 130,
          y: 160,
        });
        overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 420, y: 330 });
        const started = performance.now();
        overlay.webContents.sendInputEvent({
          type: 'mouseUp',
          button: 'left',
          clickCount: 1,
          x: 420,
          y: 330,
        });
        await waitUntil(() =>
          evaluate("!document.querySelector('.selection-toolbar').hidden")
        );
        console.log(
          'Toolbar before capture:',
          action,
          Math.round(performance.now() - started) + 'ms'
        );
        assert.equal(
          await evaluate("document.querySelector('.capture-surface').dataset.state"),
          'capturing'
        );
        assert.equal(
          await evaluate("document.querySelector('.screen-frame').width"),
          0
        );
        for (const selector of [
          '.annotation-canvas',
          '.confirm-button',
          '.cancel-button',
        ]) {
          assert.notEqual(
            await evaluate(
              `getComputedStyle(document.querySelector('${selector}')).cursor`
            ),
            'none',
            'Keep native cursors throughout live capture'
          );
        }
        assert.equal(
          await evaluate(
            "document.querySelector('.selection-toolbar').getAttribute('aria-busy')"
          ),
          'true'
        );
        assert.equal(
          await evaluate("document.querySelector('.capture-pointer') === null"),
          true
        );
        await measureHover('capturing');
        if (action === 'cancel') {
          await evaluate("document.querySelector('.cancel-button').click()");
          assert.equal((await result).status, 'cancelled');
          release();
          await pause(100);
          assert.equal(overlay.isVisible(), false);
        } else if (action === 'edit') {
          await evaluate("document.querySelector('[data-tool=rectangle]').click()");
          release();
          await waitUntil(() =>
            evaluate(
              "document.querySelector('.capture-surface').dataset.state==='selected' && document.querySelector('.selection-toolbar').getAttribute('aria-busy')==='false'"
            )
          );
          assert.equal(
            await evaluate("document.querySelector('.capture-surface').dataset.tool"),
            'rectangle'
          );

          assert.equal(
            await evaluate(
              "getComputedStyle(document.querySelector('.confirm-button')).cursor"
            ),
            'pointer',
            'Restore editor cursors after pixels are available'
          );
          await measureHover('selected');
          for (const theme of ['dark', 'light']) {
            await evaluate(`document.documentElement.dataset.snaporaTheme='${theme}'`);
            for (const selector of ['.confirm-button', '[data-tool=rectangle]']) {
              overlay.webContents.sendInputEvent({ type: 'mouseMove', x: 20, y: 20 });
              await pause(120);
              const normal = await evaluate(
                `(() => {const e=document.querySelector('${selector}'),s=getComputedStyle(e),r=e.getBoundingClientRect();return {background:s.backgroundColor,color:s.color,x:r.x+r.width/2,y:r.y+r.height/2}})()`
              );
              overlay.webContents.sendInputEvent({
                type: 'mouseMove',
                x: Math.round(normal.x),
                y: Math.round(normal.y),
              });
              await pause(120);
              const hover = await evaluate(
                `(() => {const e=document.querySelector('${selector}'),s=getComputedStyle(e);return {hovered:e.matches(':hover'),background:s.backgroundColor,color:s.color}})()`
              );
              assert.equal(
                hover.hovered,
                true,
                JSON.stringify({
                  theme,
                  selector,
                  normal,
                  hover,
                  target: await evaluate(
                    `document.elementFromPoint(${Math.round(normal.x)},${Math.round(normal.y)})?.outerHTML`
                  ),
                })
              );
              assert.equal(hover.background, normal.background);
              assert.equal(hover.color, normal.color);
            }
          }
          const directory = join(__dirname, '../../.pack-preview');
          mkdirSync(directory, { recursive: true });
          const bounds = await evaluate(
            "(() => {const r=document.querySelector('.selection-toolbar').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()"
          );
          writeFileSync(
            join(directory, 'toolbar-hover.png'),
            (await overlay.webContents.capturePage(bounds)).toPNG()
          );
          manager.cancel();
          assert.equal((await result).status, 'cancelled');
        } else {
          await evaluate(
            "document.querySelector('.confirm-button').click();document.querySelector('.confirm-button').click()"
          );
          assert.equal(outputCount, 0);
          release();
          assert.equal((await result).status, 'completed');
          assert.equal(outputCount, 1);
        }
      }
      console.log(
        'Immediate toolbar, delayed pixels, cancel, tool persistence, deferred confirmation and hover passed.'
      );
    } finally {
      release?.();
      manager?.dispose();
      adapter?.dispose();
      fixture?.destroy();
      clearTimeout(deadline);
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
