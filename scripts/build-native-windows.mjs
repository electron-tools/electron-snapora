/** Build Windows helpers before distribution; no compiler or shell is used by runtime adapters. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const windowsHelperSources = {
  'snapora-windows-snap.exe': ['windows-snap.cs', 'windows-snap-entry.cs'],
  'snapora-windows-capture.exe': ['windows-capture.cs'],
};
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
// Git's Windows checkout may use CRLF; source identity must survive artifact transfer to macOS.
export const sourceHash = (data) =>
  sha256(data.toString('utf8').replaceAll('\r\n', '\n'));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(root, 'src/electron/native');

/** Also used by native regression tests to compile the real worker with a test entry point. */
export function compileWindowsHelper(sources, output, entryPoint) {
  if (process.platform !== 'win32')
    throw new Error('Windows helper compilation requires Windows.');
  const windows = process.env.SystemRoot ?? 'C:\\Windows';
  const framework = ['Framework64', 'Framework']
    .map((name) => join(windows, 'Microsoft.NET', name, 'v4.0.30319'))
    .find((path) => existsSync(join(path, 'csc.exe')));
  if (!framework)
    throw new Error(
      'Windows .NET Framework C# compiler was not found on the build machine.'
    );
  const references = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(
    (name) => {
      const gac = join(windows, 'Microsoft.NET/assembly/GAC_MSIL', name);
      const assembly = readdirSync(gac)
        .filter((version) => version.startsWith('v4.0_'))
        .map((version) => join(gac, version, `${name}.dll`))
        .find(existsSync);
      if (!assembly) throw new Error(`Missing build reference: ${name}`);
      return `/reference:${assembly}`;
    }
  );
  mkdirSync(dirname(output), { recursive: true });
  const result = spawnSync(
    join(framework, 'csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:anycpu',
      '/optimize+',
      '/debug-',
      '/reference:System.Drawing.dll',
      ...references,
      ...(entryPoint ? [`/main:${entryPoint}`] : []),
      `/out:${output}`,
      ...sources,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 }
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `Windows helper build failed: ${result.error?.message ?? result.stdout + result.stderr}`
    );
}

/** Build both AnyCPU executables and bind the resulting artifacts to their source hashes. */
export function buildWindowsHelpers() {
  const manifest = { schema: 1, target: 'net-framework-anycpu', helpers: {} };
  for (const [name, sources] of Object.entries(windowsHelperSources)) {
    const output = join(native, name);
    compileWindowsHelper(
      sources.map((source) => join(native, source)),
      output
    );
    manifest.helpers[name] = {
      sha256: sha256(readFileSync(output)),
      sources: Object.fromEntries(
        sources.map((source) => [
          source,
          sourceHash(readFileSync(join(native, source))),
        ])
      ),
    };
  }
  writeFileSync(
    join(native, 'windows-helpers.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  console.log('Built precompiled Windows UIA and screen capture helpers (AnyCPU).');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.platform === 'win32' || !process.argv.includes('--if-windows'))
    buildWindowsHelpers();
}
