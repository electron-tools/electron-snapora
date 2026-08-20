import assert from 'node:assert/strict';
import test from 'node:test';

import { releaseMetadataErrors } from './verify-release-metadata.mjs';

const validPackage = {
  name: 'electron-snapora',
  version: '0.1.0-alpha.0',
  license: 'MIT',
  repository: {
    url: 'git+https://github.com/electron-tools/electron-snapora.git',
  },
  publishConfig: {
    access: 'public',
    registry: 'https://registry.npmjs.org/',
    tag: 'next',
  },
};

test('accepts complete prerelease metadata', () => {
  assert.deepEqual(
    releaseMetadataErrors(validPackage, () => true),
    []
  );
});

test('reports owner decisions and unsafe publish targets', () => {
  const errors = releaseMetadataErrors(
    {
      ...validPackage,
      version: '0.0.0',
      license: undefined,
      publishConfig: {
        access: 'restricted',
        registry: 'https://registry.npmmirror.com/',
        tag: 'latest',
      },
    },
    () => false
  );

  assert.equal(errors.length, 7);
  assert.ok(errors.some((error) => error.includes('version 0.0.0')));
  assert.ok(errors.some((error) => error.includes('SPDX license')));
  assert.ok(errors.some((error) => error.includes('registry.npmjs.org')));
  assert.ok(errors.some((error) => error.includes('must remain next')));
});
