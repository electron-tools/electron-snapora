/** Compile/run native regression code and actual executable protocols without screenshots. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  compileWindowsHelper,
  buildWindowsHelpers,
} from '../../scripts/build-native-windows.mjs';
import { verifyWindowsHelpers } from '../../scripts/verify-native-windows.mjs';

const native = resolve('src/electron/native');
const options = { encoding: 'utf8', windowsHide: true, timeout: 15000 };
const windowsOnly = { skip: process.platform !== 'win32' };

test(
  'native UIA rejects displaced surfaces without losing legitimate clipping',
  windowsOnly,
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'snapora-native-bounds-'));
    try {
      const exe = join(directory, 'geometry-test.exe');
      compileWindowsHelper(
        [
          join(native, 'windows-snap.cs'),
          resolve('test/native/windows-snap-geometry.cs'),
        ],
        exe
      );
      const result = spawnSync(exe, [], options);
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.match(result.stdout, /native bounds checks passed/);
    } finally {
      assert.ok(
        resolve(directory).startsWith(resolve(tmpdir(), 'snapora-native-bounds-'))
      );
      rmSync(directory, { recursive: true, force: true });
    }
  }
);

test(
  'precompiled helpers support reuse, EOF shutdown and bounded invalid requests',
  windowsOnly,
  () => {
    buildWindowsHelpers();
    verifyWindowsHelpers(native, native);
    const result = spawnSync(join(native, 'snapora-windows-snap.exe'), ['--server'], {
      ...options,
      input: 'invalid\nwindow\nwindow\n',
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    const records = result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(records.filter((row) => row.ready).length, 1);
    assert.equal(records.filter((row) => row.done).length, 2);
    assert.equal(records.filter((row) => row.windowsReady).length, 2);
    const badArgs = spawnSync(
      join(native, 'snapora-windows-snap.exe'),
      ['--unknown'],
      options
    );
    assert.equal(badArgs.status, 2);
    // Invalid dimensions fail before pixel copying; don't capture the user's desktop in this test.
    const capture = spawnSync(join(native, 'snapora-windows-capture.exe'), [], {
      ...options,
      input: '0|0|0|0\ninvalid\n',
    });
    assert.equal(capture.status, 0, capture.error?.message ?? capture.stderr);
    assert.deepEqual(capture.stdout.trim().split(/\r?\n/), ['ready', 'error', 'error']);
  }
);

test('release gate rejects missing, stale or corrupt Windows artifacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapora-native-artifacts-'));
  try {
    assert.throws(() => verifyWindowsHelpers(directory), /ENOENT/);
    writeFileSync(join(directory, 'windows-helpers.json'), '{"schema":0}');
    assert.throws(() => verifyWindowsHelpers(directory), /manifest/);
    if (process.platform !== 'win32') return;
    const manifest = JSON.parse(
      readFileSync(join(native, 'windows-helpers.json'), 'utf8')
    );
    for (const name of Object.keys(manifest.helpers)) {
      writeFileSync(join(directory, name), readFileSync(join(native, name)));
    }
    writeFileSync(join(directory, 'windows-helpers.json'), JSON.stringify(manifest));
    verifyWindowsHelpers(directory, native);
    manifest.helpers['snapora-windows-snap.exe'].sources['windows-snap.cs'] = 'old';
    writeFileSync(join(directory, 'windows-helpers.json'), JSON.stringify(manifest));
    assert.throws(() => verifyWindowsHelpers(directory, native), /Stale/);
    writeFileSync(join(directory, 'snapora-windows-snap.exe'), 'broken');
    assert.throws(() => verifyWindowsHelpers(directory), /Invalid Windows executable/);
  } finally {
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir(), 'snapora-native-artifacts-'))
    );
    rmSync(directory, { recursive: true, force: true });
  }
});
