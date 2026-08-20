import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function releaseMetadataErrors(packageJson, fileExists) {
  const errors = [];

  if (packageJson.name !== 'electron-snapora') {
    errors.push('package name must remain electron-snapora');
  }
  if (!packageJson.version || packageJson.version === '0.0.0') {
    errors.push('replace version 0.0.0 with the approved release version');
  }
  if (!packageJson.license) {
    errors.push('choose an SPDX license and set package.json#license');
  }
  if (!fileExists('LICENSE')) {
    errors.push('add the owner-approved LICENSE file');
  }
  if (!fileExists('CHANGELOG.md')) {
    errors.push('add CHANGELOG.md');
  }
  if (packageJson.private === true) {
    errors.push('package.json#private must not be true');
  }

  const publishConfig = packageJson.publishConfig ?? {};
  if (publishConfig.registry !== 'https://registry.npmjs.org/') {
    errors.push('publishConfig.registry must be https://registry.npmjs.org/');
  }
  if (publishConfig.access !== 'public') {
    errors.push('publishConfig.access must be public');
  }
  const expectedTag = packageJson.version?.includes('-') ? 'next' : 'latest';
  if (publishConfig.tag !== expectedTag) {
    errors.push(
      `publishConfig.tag must be ${expectedTag} for ${packageJson.version?.includes('-') ? 'prerelease' : 'stable'} versions`
    );
  }

  const repositoryUrl = packageJson.repository?.url;
  if (repositoryUrl !== 'git+https://github.com/electron-tools/electron-snapora.git') {
    errors.push('repository.url must match the trusted publishing repository');
  }

  return errors;
}

function main() {
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
  );
  const errors = releaseMetadataErrors(packageJson, (relativePath) =>
    existsSync(join(repositoryRoot, relativePath))
  );

  if (errors.length > 0) {
    console.error('[release] metadata check failed:');
    for (const error of errors) {
      console.error(`[release] - ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `[release] metadata check passed for ${packageJson.name}@${packageJson.version}`
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
