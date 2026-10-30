// Verify platform gating and build failures without invoking a compiler or Electron.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function run(platform, release, result = { status: 0 }) {
  const calls = [];
  const process = { platform, execPath: '/node' };
  vm.runInNewContext(
    readFileSync(join(__dirname, '../../scripts/prepare-demo.cjs'), 'utf8'),
    {
      process,
      __dirname: '/scripts',
      console: { log() {}, error() {} },
      require(name) {
        if (name === 'node:os') return { release: () => release };
        if (name === 'node:path') return { join };
        assert.equal(name, 'node:child_process');
        return {
          spawnSync: (...args) => {
            calls.push(args);
            return result;
          },
        };
      },
    }
  );
  return { calls, process };
}

test('normal demo startup builds the helper on macOS 14+ only', () => {
  for (const version of ['23.0.0', '24.5.0']) {
    const { calls, process } = run('darwin', version);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/node');
    assert.match(calls[0][1][0], /build-native-mac\.mjs$/);
    assert.equal(process.exitCode, undefined);
  }
  for (const [platform, version] of [
    ['darwin', '22.6.0'],
    ['win32', '10.0.0'],
    ['linux', '6.0.0'],
  ]) {
    assert.equal(run(platform, version).calls.length, 0);
  }
});

test('failed or interrupted helper compilation stops demo startup', () => {
  assert.equal(run('darwin', '23.0.0', { status: 2 }).process.exitCode, 2);
  assert.equal(run('darwin', '23.0.0', { status: null }).process.exitCode, 1);
  assert.throws(
    () => run('darwin', '23.0.0', { error: new Error('spawn failed') }),
    /spawn failed/
  );
});
