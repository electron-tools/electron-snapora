import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test production Swift policy without running the screen/AX helper or requesting privacy access.
if (process.platform !== 'darwin')
  throw new Error('test:native:mac requires macOS and Xcode Command Line Tools.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = join(root, '.pack-preview/mac-native-tests');
mkdirSync(directory, { recursive: true });
const executable = join(directory, 'snap-policy-tests');
for (const [command, args] of [
  [
    '/usr/bin/xcrun',
    [
      'swiftc',
      '-swift-version',
      '5',
      '-parse-as-library',
      '-O',
      join(root, 'src/electron/native/macos-snap-policy.swift'),
      join(root, 'test/electron/native/macos-snap-policy.test.swift'),
      '-o',
      executable,
    ],
  ],
  [executable, []],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
