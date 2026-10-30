import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Build once on macOS, then ship a signed executable. Runtime users do not need Xcode.
if (process.platform !== 'darwin')
  throw new Error('build:native:mac requires macOS and Xcode Command Line Tools.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const native = join(root, 'src/electron/native');
const output = join(native, 'snapora-macos');
const buildDirectory = join(root, '.pack-preview/mac-native-build');
mkdirSync(buildDirectory, { recursive: true });
const architectures = process.argv.includes('--universal')
  ? ['arm64', 'x86_64']
  : [process.arch === 'arm64' ? 'arm64' : 'x86_64'];
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
const outputs = architectures.map((arch) => {
  const path = join(buildDirectory, `snapora-macos-${arch}`);
  run('/usr/bin/xcrun', [
    'swiftc',
    '-swift-version',
    '5',
    '-parse-as-library',
    '-O',
    '-target',
    `${arch}-apple-macos14.0`,
    join(native, 'macos-helper.swift'),
    join(native, 'macos-snap-policy.swift'),
    '-o',
    path,
  ]);
  return path;
});
if (outputs.length > 1)
  run('/usr/bin/lipo', ['-create', ...outputs, '-output', output]);
else copyFileSync(outputs[0], output);
chmodSync(output, 0o755);
// Development signature only. Release packaging must re-sign with the app's Developer ID.
run('/usr/bin/codesign', [
  '--force',
  '--sign',
  '-',
  '--identifier',
  'dev.snapora.macos-helper',
  output,
]);
mkdirSync(join(root, 'dist/native'), { recursive: true });
copyFileSync(output, join(root, 'dist/native/snapora-macos'));
chmodSync(join(root, 'dist/native/snapora-macos'), 0o755);
console.log(`Built ${output} (${architectures.join(', ')}).`);
