import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
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
const fixtureRoot = join(repositoryRoot, 'integration', 'consumers', 'packaged');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'electron-snapora-packaged-'));
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error('Run packaged consumer verification through pnpm.');
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

function findTarball() {
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

function prepareConsumer(tarballPath) {
  const consumerDirectory = join(temporaryRoot, 'consumer');
  cpSync(fixtureRoot, consumerDirectory, { recursive: true });
  const packageJsonPath = join(consumerDirectory, 'package.json');
  const packageJson = readFileSync(packageJsonPath, 'utf8').replace(
    '__SNAPORA_TARBALL__',
    tarballPath.replaceAll('\\', '/')
  );
  writeFileSync(packageJsonPath, packageJson);
  runPnpm(
    ['install', '--prefer-offline', '--ignore-scripts', '--no-frozen-lockfile'],
    consumerDirectory
  );
  // 临时项目禁用所有安装脚本；首次调用官方 CLI 时再按 Electron 自身机制准备分发目录。
  runPnpm(['exec', 'electron', '--version'], consumerDirectory);
  return consumerDirectory;
}

function packagedExecutable(outputDirectory) {
  if (process.platform === 'win32') {
    return join(outputDirectory, 'win-unpacked', 'snapora-package-check.exe');
  }
  if (process.platform === 'darwin') {
    return join(
      outputDirectory,
      'mac',
      'Electron Snapora Package Check.app',
      'Contents',
      'MacOS',
      'Electron Snapora Package Check'
    );
  }
  return join(outputDirectory, 'linux-unpacked', 'snapora-package-check');
}

/** 同一消费应用分别以 ASAR 和普通目录打包，启动成品验证三类静态资源。 */
function verifyPackagingMode(consumerDirectory, mode, asar) {
  const outputDirectory = join(consumerDirectory, `release-${mode}`);
  const electronDist = join(consumerDirectory, 'node_modules', 'electron', 'dist');
  if (!existsSync(electronDist)) {
    throw new Error(`Consumer Electron distribution is missing: ${electronDist}`);
  }
  runPnpm(
    [
      'exec',
      'electron-builder',
      '--dir',
      '--publish',
      'never',
      '--projectDir',
      consumerDirectory,
      `--config.asar=${String(asar)}`,
      `--config.electronDist=${electronDist}`,
      `--config.directories.output=${outputDirectory}`,
    ],
    repositoryRoot
  );

  const executablePath = packagedExecutable(outputDirectory);
  if (!existsSync(executablePath)) {
    throw new Error(`Packaged executable was not created: ${executablePath}`);
  }
  const resultPath = join(temporaryRoot, `result-${mode}.json`);
  execFileSync(executablePath, [], {
    env: { ...process.env, SNAPORA_VERIFY_OUTPUT: resultPath },
    stdio: 'inherit',
    timeout: 30_000,
  });
  if (!existsSync(resultPath)) {
    throw new Error(`Packaged ${mode} app did not write its verification result.`);
  }
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  if (result.status !== 'passed') {
    throw new Error(`Packaged ${mode} app failed: ${result.message}`);
  }
}

try {
  const consumerDirectory = prepareConsumer(findTarball());
  verifyPackagingMode(consumerDirectory, 'asar', true);
  verifyPackagingMode(consumerDirectory, 'directory', false);
  console.log('Electron Snapora electron-builder ASAR and directory consumers passed.');
} finally {
  rmSync(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
