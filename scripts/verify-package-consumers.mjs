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
const fixturesRoot = join(repositoryRoot, 'integration', 'consumers');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'electron-snapora-consumers-'));
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error('Run package consumer verification through pnpm.');
}

function runPnpm(args, cwd) {
  const isJavaScriptCli = /\.[cm]?js$/i.test(pnpmCli);
  const isWindowsShim = process.platform === 'win32' && pnpmCli === 'pnpm';
  const executable = isJavaScriptCli
    ? process.execPath
    : isWindowsShim
      ? (process.env.ComSpec ?? 'cmd.exe')
      : pnpmCli;
  const commandArgs = isJavaScriptCli
    ? [pnpmCli, ...args]
    : isWindowsShim
      ? ['/d', '/s', '/c', pnpmCli, ...args]
      : args;

  execFileSync(executable, commandArgs, {
    cwd,
    stdio: 'inherit',
  });
}

/** 每个消费项目都从真实 tgz 安装，避免仓库 self-reference 掩盖 exports 或资源缺失。 */
function prepareConsumer(name, tarballPath) {
  const consumerDirectory = join(temporaryRoot, name);
  cpSync(join(fixturesRoot, name), consumerDirectory, { recursive: true });
  const packageJsonPath = join(consumerDirectory, 'package.json');
  const packageJson = readFileSync(packageJsonPath, 'utf8').replace(
    '__SNAPORA_TARBALL__',
    tarballPath.replaceAll('\\', '/')
  );
  writeFileSync(packageJsonPath, packageJson);
  return consumerDirectory;
}

try {
  runPnpm(
    ['pack', '--config.ignore-scripts=true', '--pack-destination', temporaryRoot],
    repositoryRoot
  );
  const tarballName = readdirSync(temporaryRoot).find((name) => name.endsWith('.tgz'));
  if (!tarballName) {
    throw new Error('pnpm pack did not create an electron-snapora tarball.');
  }
  const tarballPath = join(temporaryRoot, tarballName);

  for (const name of ['esm', 'commonjs']) {
    const consumerDirectory = prepareConsumer(name, tarballPath);
    runPnpm(
      ['install', '--prefer-offline', '--ignore-scripts', '--no-frozen-lockfile'],
      consumerDirectory
    );
    runPnpm(['exec', 'tsc', '--noEmit'], consumerDirectory);
    runPnpm(
      ['exec', 'electron', name === 'esm' ? 'runtime.mjs' : 'runtime.cjs'],
      consumerDirectory
    );
  }

  console.log('Electron Snapora ESM and CommonJS tarball consumers passed.');
} finally {
  rmSync(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
}
