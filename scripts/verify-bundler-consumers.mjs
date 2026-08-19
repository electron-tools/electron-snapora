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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(repositoryRoot, 'integration', 'consumers', 'bundlers');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'electron-snapora-bundlers-'));
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error('Run bundler consumer verification through pnpm.');
}

function runPnpm(args, cwd) {
  execFileSync(process.execPath, [pnpmCli, ...args], {
    cwd,
    stdio: 'inherit',
  });
}

function prepareConsumer() {
  runPnpm(['pack', '--pack-destination', temporaryRoot], repositoryRoot);
  const tarballName = readdirSync(temporaryRoot).find((name) => name.endsWith('.tgz'));
  if (!tarballName) {
    throw new Error('pnpm pack did not create an electron-snapora tarball.');
  }

  const consumerDirectory = join(temporaryRoot, 'consumer');
  cpSync(fixtureRoot, consumerDirectory, { recursive: true });
  const packageJsonPath = join(consumerDirectory, 'package.json');
  const packageJson = readFileSync(packageJsonPath, 'utf8').replace(
    '__SNAPORA_TARBALL__',
    join(temporaryRoot, tarballName).replaceAll('\\', '/')
  );
  writeFileSync(packageJsonPath, packageJson);
  runPnpm(['install', '--ignore-scripts', '--no-frozen-lockfile'], consumerDirectory);
  return consumerDirectory;
}

/** 主进程产物必须保留包引用；如果静态资源定位代码被内联，__dirname 会指向宿主输出目录。 */
function assertExternalized(bundlePath, label) {
  const bundle = readFileSync(bundlePath, 'utf8');
  if (!bundle.includes('electron-snapora/main')) {
    throw new Error(`${label} did not preserve the electron-snapora external import.`);
  }
  if (bundle.includes('[electron-snapora] Packaged resource missing')) {
    throw new Error(
      `${label} bundled electron-snapora into the host main-process file.`
    );
  }
}

try {
  const consumerDirectory = prepareConsumer();
  runPnpm(['exec', 'electron-vite', 'build'], consumerDirectory);
  assertExternalized(
    join(consumerDirectory, 'out', 'electron-vite', 'main.cjs'),
    'electron-vite'
  );

  runPnpm(['exec', 'webpack', '--config', 'webpack.config.cjs'], consumerDirectory);
  assertExternalized(join(consumerDirectory, 'out', 'webpack', 'main.cjs'), 'webpack');
  console.log('Electron Snapora electron-vite and webpack external checks passed.');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
