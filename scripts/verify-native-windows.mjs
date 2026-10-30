/** Release gate: require both precompiled Windows helpers, tied to the current source revision. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256, sourceHash, windowsHelperSources } from './build-native-windows.mjs';

/** Validate artifact hashes and reject missing helpers or stale source builds on any release OS. */
export function verifyWindowsHelpers(directory, sourceDirectory) {
  const manifest = JSON.parse(
    readFileSync(join(directory, 'windows-helpers.json'), 'utf8')
  );
  if (manifest.schema !== 1 || manifest.target !== 'net-framework-anycpu')
    throw new Error('Invalid Windows helper manifest.');
  for (const [name, sources] of Object.entries(windowsHelperSources)) {
    const artifact = readFileSync(join(directory, name));
    const entry = manifest.helpers?.[name];
    if (
      artifact.length < 64 ||
      artifact.toString('ascii', 0, 2) !== 'MZ' ||
      sha256(artifact) !== entry?.sha256
    )
      throw new Error(`Invalid Windows executable: ${name}`);
    if (sourceDirectory)
      for (const source of sources) {
        if (
          sourceHash(readFileSync(join(sourceDirectory, source))) !==
          entry.sources?.[source]
        )
          throw new Error(`Stale Windows helper source: ${source}`);
      }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  verifyWindowsHelpers(join(root, 'dist/native'), join(root, 'src/electron/native'));
  console.log('Precompiled Windows helpers match the current native sources.');
}
