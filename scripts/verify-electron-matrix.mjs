import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const electronVersions = ['42.8.0', '43.3.0'];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(repositoryRoot, 'integration', 'consumers', 'compatibility');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'electron-snapora-matrix-'));
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error('Run Electron compatibility verification through pnpm.');
}

function runPnpm(args, cwd, environment = {}) {
  execFileSync(process.execPath, [pnpmCli, ...args], {
    cwd,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  });
}

function createTarball() {
  runPnpm(
    ['pack', '--config.ignore-scripts=true', '--pack-destination', temporaryRoot],
    repositoryRoot
  );
  const tarballName = readdirSync(temporaryRoot).find((name) => name.endsWith('.tgz'));
  if (!tarballName) {
    throw new Error('pnpm pack did not create an electron-snapora tarball.');
  }
  return join(temporaryRoot, tarballName);
}

/** 每个 Electron 版本使用全新消费目录，避免 pnpm 链接或二进制缓存掩盖兼容问题。 */
function verifyElectronVersion(version, tarballPath) {
  const consumerDirectory = join(temporaryRoot, `electron-${version}`);
  cpSync(fixtureRoot, consumerDirectory, { recursive: true });
  const packageJsonPath = join(consumerDirectory, 'package.json');
  const packageJson = readFileSync(packageJsonPath, 'utf8')
    .replace('__SNAPORA_TARBALL__', tarballPath.replaceAll('\\', '/'))
    .replace('__ELECTRON_VERSION__', version);
  writeFileSync(packageJsonPath, packageJson);

  runPnpm(['install', '--ignore-scripts', '--no-frozen-lockfile'], consumerDirectory);
  runPnpm(['exec', 'electron', '--version'], consumerDirectory);
  runPnpm(['exec', 'electron', 'main.cjs'], consumerDirectory, {
    SNAPORA_EXPECTED_ELECTRON_MAJOR: version.split('.')[0],
  });
}

try {
  const tarballPath = createTarball();
  for (const version of electronVersions) {
    verifyElectronVersion(version, tarballPath);
  }
  console.log(
    `Electron Snapora compatibility matrix passed: ${electronVersions.join(', ')}.`
  );
} finally {
  rmSync(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
