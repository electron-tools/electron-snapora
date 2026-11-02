// Real local sockets verify checkout isolation and graceful restart without launching Electron.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { endpoint, stopPreviousDemo } = require('../../demo/lifecycle.cjs');

async function fixture(t, busy = false) {
  const root = mkdtempSync(join(tmpdir(), 'snapora-lifecycle-'));
  const address = endpoint(root);
  const modulePath = require.resolve('../../demo/lifecycle.cjs');
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const { listenForRestart } = require(${JSON.stringify(modulePath)});
    let server;
    listenForRestart({ isBusy: () => ${busy}, quit: () => server.close(() => process.exit(0)) }, process.argv[1])
      .then(s => { server = s; console.log('ready'); });
  `,
      address,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill();
      await exit;
    }
    rmdirSync(root);
  });
  const [ready] = await once(child.stdout, 'data');
  assert.equal(ready.toString().trim(), 'ready');
  return { child, address };
}

test('absent demo does not block first startup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapora-lifecycle-'));
  try {
    assert.equal(await stopPreviousDemo(endpoint(root)), false);
  } finally {
    rmdirSync(root);
  }
});

test(
  'restart waits for the matching checkout to exit and leaves another checkout running',
  { timeout: 15000 },
  async (t) => {
    const first = await fixture(t);
    const second = await fixture(t);
    assert.notEqual(first.address, second.address);
    assert.equal(await stopPreviousDemo(first.address), true);
    assert.equal(first.child.exitCode, 0);
    assert.equal(second.child.exitCode, null);
    assert.equal(await stopPreviousDemo(second.address), true);
  }
);

test(
  'active capture or unsaved preview refuses restart without terminating the demo',
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, true);
    await assert.rejects(stopPreviousDemo(f.address), /先完成或取消/);
    assert.equal(f.child.exitCode, null);
  }
);
