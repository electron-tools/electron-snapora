const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function fixture(platform = 'darwin', active = false) {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  let loads = 0;
  let restores = 0;
  const helper = {
    getFrontmostProcess: () => ({ psn: {}, pid: 2 }),
    restoreFrontmostProcess: async () => {
      restores++;
    },
  };
  const manager = {
    capture: () => {
      calls++;
      return pending;
    },
  };
  const host = {
    destroyed: false,
    changes: [],
    isDestroyed() {
      return this.destroyed;
    },
    isFocusable: () => true,
    setFocusable(value) {
      this.changes.push(value);
    },
  };
  const context = {
    console,
    process: { platform, pid: 1 },
    require(name) {
      if (name === 'node:path') return { join };
      if (name === 'electron')
        return {
          app: { isActive: () => active, whenReady: () => ({ then() {} }), on() {} },
          BrowserWindow: {},
          globalShortcut: {},
          ipcMain: {},
        };
      if (name === 'electron-snapora/main')
        return {
          ScreenshotManager: function () {
            return manager;
          },
        };
      assert.equal(name, './mac-window-focus.cjs');
      loads++;
      return helper;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    readFileSync(join(__dirname, 'main.cjs'), 'utf8') +
      '\nglobalThis.run = triggerDemoScreenshot; globalThis.hosts = hostWindows;',
    context
  );
  context.hosts.add(host);
  return {
    context,
    host,
    manager,
    helper,
    finish,
    get calls() {
      return calls;
    },
    get loads() {
      return loads;
    },
    get restores() {
      return restores;
    },
  };
}

test('background capture protects only owned hosts and blocks duplicate triggers', async () => {
  const f = fixture();
  const pending = f.context.run();
  assert.deepEqual(f.host.changes, [false]);
  await f.context.run();
  assert.equal(f.calls, 1);
  f.finish();
  await pending;
  assert.deepEqual(f.host.changes, [false, true]);
  assert.equal(f.restores, 1);
  await f.context.run();
  assert.equal(f.calls, 2);
});

test('an existing IPC capture blocks host state changes', async () => {
  const f = fixture();
  f.manager.activeJobId = 'ipc';
  await f.context.run();
  assert.equal(f.calls, 0);
  assert.equal(f.loads, 0);
});

for (const [platform, active] of [
  ['win32', false],
  ['darwin', true],
]) {
  test(
    platform + ' active=' + active + ' does not load native focus helpers',
    async () => {
      const f = fixture(platform, active);
      const pending = f.context.run();
      f.finish();
      await pending;
      assert.equal(f.calls, 1);
      assert.equal(f.loads, 0);
      assert.deepEqual(f.host.changes, []);
    }
  );
}

test('capture failure restores state and releases the guard', async () => {
  const f = fixture();
  f.manager.capture = async () => {
    throw Error('capture failed');
  };
  await assert.rejects(f.context.run(), /capture failed/);
  assert.deepEqual(f.host.changes, [false, true]);
  f.manager.capture = async () => {};
  await f.context.run();
  assert.equal(f.restores, 2);
});

test('asynchronous restoration stays guarded; destroyed hosts are skipped', async () => {
  const f = fixture();
  let restore;
  f.helper.restoreFrontmostProcess = () =>
    new Promise((resolve) => {
      restore = resolve;
    });
  const pending = f.context.run();
  f.finish();
  await new Promise(setImmediate);
  await f.context.run();
  assert.equal(f.calls, 1);
  f.host.destroyed = true;
  restore();
  await pending;
  assert.deepEqual(f.host.changes, [false]);
});

test('restoration failure still restores focusability and releases the guard', async () => {
  const f = fixture();
  f.helper.restoreFrontmostProcess = async () => {
    throw Error('restore failed');
  };
  const pending = f.context.run();
  f.finish();
  await assert.rejects(pending, /restore failed/);
  assert.deepEqual(f.host.changes, [false, true]);
  f.helper.restoreFrontmostProcess = async () => {};
  await f.context.run();
  assert.equal(f.calls, 2);
});

test('native helper restores via PSN before falling back to PID', async () => {
  let failPsn = false;
  let fallback = 0;
  const context = {
    console,
    process: { pid: 1 },
    module: { exports: {} },
    require(name) {
      if (name === 'node:child_process')
        return {
          execFile(command, args, done) {
            assert.equal(command, 'osascript');
            assert.ok(
              args.includes('set targetProcess to first process whose unix id is 2')
            );
            assert.ok(
              args.includes('perform action "AXRaise" of every window of targetProcess')
            );
            fallback++;
            done(null);
          },
        };
      assert.equal(name, 'koffi');
      return {
        struct() {},
        load() {
          return {
            func(signature) {
              if (signature.includes('GetFrontProcess'))
                return (psn) => {
                  psn.lowLongOfPSN = 5;
                  return 0;
                };
              if (signature.includes('GetProcessPID'))
                return (_psn, pid) => {
                  pid[0] = 2;
                  return 0;
                };
              return (psn) => {
                assert.equal(psn.lowLongOfPSN, 5);
                return failPsn ? -1 : 0;
              };
            },
          };
        },
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    readFileSync(join(__dirname, 'mac-window-focus.cjs'), 'utf8'),
    context
  );
  const { getFrontmostProcess, restoreFrontmostProcess } = context.module.exports;
  const previous = getFrontmostProcess();
  assert.equal(previous.pid, 2);
  assert.equal(await restoreFrontmostProcess(previous), true);
  assert.equal(fallback, 0);
  failPsn = true;
  assert.equal(await restoreFrontmostProcess(previous), true);
  assert.equal(fallback, 1);
});
