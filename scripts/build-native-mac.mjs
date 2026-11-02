import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Build once on macOS, then ship a signed executable. Runtime users do not need Xcode.
if (process.platform !== 'darwin')
  throw new Error('build:native:mac requires macOS and Xcode Command Line Tools.');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const native = join(root, 'src/electron/native');
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
for (const [name, sources] of [
  ['snapora-macos', ['macos-helper.swift', 'macos-snap-policy.swift']],
  ['snapora-macos-recording', ['macos-recording.swift']],
]) {
  const executable = join(native, name);
  const outputs = architectures.map((arch) => {
    const path = join(buildDirectory, `${name}-${arch}`);
    run('/usr/bin/xcrun', [
      'swiftc',
      '-swift-version',
      '5',
      '-parse-as-library',
      '-O',
      '-target',
      `${arch}-apple-macos14.0`,
      ...sources.map((source) => join(native, source)),
      '-o',
      path,
    ]);
    return path;
  });
  if (outputs.length > 1)
    run('/usr/bin/lipo', ['-create', ...outputs, '-output', executable]);
  else copyFileSync(outputs[0], executable);
  chmodSync(executable, 0o755);
  // Development signature only; the host's release build must apply its Developer ID.
  run('/usr/bin/codesign', [
    '--force',
    '--sign',
    '-',
    '--identifier',
    name === 'snapora-macos'
      ? 'dev.snapora.macos-helper'
      : 'dev.snapora.macos-recording',
    executable,
  ]);
  mkdirSync(join(root, 'dist/native'), { recursive: true });
  copyFileSync(executable, join(root, 'dist/native', name));
  chmodSync(join(root, 'dist/native', name), 0o755);
  console.log(`Built ${executable} (${architectures.join(', ')}).`);
}
