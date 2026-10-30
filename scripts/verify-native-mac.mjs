// Refuse a cross-platform npm release without both supported Mac CPU slices.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

/** Inspect lipo's big-endian FAT header and each executable slice, rejecting truncated artifacts. */
export function verifyUniversalMacHelper(data) {
  if (data.length < 8 || data.readUInt32BE(0) !== 0xcafebabe)
    throw new Error(
      'Expected a universal Mach-O helper; run build:native:mac:universal.'
    );
  const count = data.readUInt32BE(4);
  if (count !== 2 || data.length < 8 + count * 20)
    throw new Error('Expected exactly arm64 and x86_64 Mach-O slices.');
  const architectures = new Set();
  const ranges = [];
  for (let index = 0; index < count; index++) {
    const entry = 8 + index * 20;
    const cpu = data.readUInt32BE(entry);
    const offset = data.readUInt32BE(entry + 8);
    const size = data.readUInt32BE(entry + 12);
    if (
      offset < 8 + count * 20 ||
      size < 32 ||
      offset + size > data.length ||
      ranges.some(([start, end]) => offset < end && offset + size > start)
    )
      throw new Error('Invalid or overlapping Mach-O slice bounds.');
    if (
      data.readUInt32LE(offset) !== 0xfeedfacf ||
      data.readUInt32LE(offset + 4) !== cpu ||
      data.readUInt32LE(offset + 12) !== 2
    )
      throw new Error('Invalid Mach-O executable slice.');
    ranges.push([offset, offset + size]);
    architectures.add(cpu);
  }
  if (!architectures.has(0x01000007) || !architectures.has(0x0100000c))
    throw new Error('The helper must contain x86_64 and arm64.');
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = join(root, 'src/electron/native/snapora-macos');
  const bundled = join(root, 'dist/native/snapora-macos');
  try {
    const data = readFileSync(bundled);
    verifyUniversalMacHelper(data);
    if (!data.equals(readFileSync(source)))
      throw new Error('Bundled helper differs from the build output.');
    if (process.platform === 'darwin') {
      if (!(statSync(bundled).mode & 0o111))
        throw new Error('Helper is not executable.');
      execFileSync(
        '/usr/bin/codesign',
        ['--verify', '--strict', '--all-architectures', bundled],
        { stdio: 'inherit' }
      );
    }
    console.log('Universal macOS helper is present in dist/native.');
  } catch (error) {
    throw new Error(
      'Mac release artifact check failed. On macOS run pnpm run build:native:mac:universal, then pnpm run build. ' +
        String(error),
      { cause: error }
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main();
