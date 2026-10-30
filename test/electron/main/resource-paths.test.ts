import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PackagedResourceError,
  resolveHostPreloadPath,
  resolveOverlayResources,
  resolveNativeHelperPath,
} from '../../../src/electron/main/resource-paths.js';

describe('resolveOverlayResources', () => {
  it('resolves external helpers to unpacked files while leaving directory builds unchanged', () => {
    for (const name of [
      'snapora-windows-snap.exe',
      'snapora-windows-capture.exe',
      'snapora-macos',
    ]) {
      expect(
        resolveNativeHelperPath(
          name,
          resolve('app.asar', 'node_modules', 'electron-snapora', 'dist', 'main')
        )
      ).toBe(
        resolve(
          'app.asar.unpacked',
          'node_modules',
          'electron-snapora',
          'dist',
          'native',
          name
        )
      );
      expect(resolveNativeHelperPath(name, resolve('package', 'dist', 'main'))).toBe(
        resolve('package', 'dist', 'native', name)
      );
      expect(resolveNativeHelperPath(name, resolve('myapp.asar', 'dist', 'main'))).toBe(
        resolve('myapp.asar', 'dist', 'native', name)
      );
    }
  });
  it('resolves sibling overlay assets from the built main entry', () => {
    const mainDirectory = resolve('package', 'dist', 'main');

    expect(resolveOverlayResources(mainDirectory, () => true)).toEqual({
      htmlPath: resolve('package', 'dist', 'overlay', 'index.html'),
      preloadPath: resolve('package', 'dist', 'overlay', 'preload.cjs'),
    });
  });

  it('resolves the bundled host preload from the built main entry', () => {
    const mainDirectory = resolve('package', 'dist', 'main');

    expect(resolveHostPreloadPath(mainDirectory, () => true)).toBe(
      resolve('package', 'dist', 'preload', 'auto.cjs')
    );
  });

  it('fails with actionable diagnostics when packaged resources are missing', () => {
    const mainDirectory = resolve('bundled-app', 'dist', 'main');

    expect(() => resolveOverlayResources(mainDirectory, () => false)).toThrow(
      /Keep electron-snapora external.*complete dist directory/
    );
    expect(() => resolveHostPreloadPath(mainDirectory, () => false)).toThrow(
      /host preload/
    );

    try {
      resolveOverlayResources(mainDirectory, () => false);
    } catch (error) {
      expect(error).toBeInstanceOf(PackagedResourceError);
      expect((error as PackagedResourceError).missingResources).toEqual([
        {
          label: 'overlay HTML',
          path: resolve('bundled-app', 'dist', 'overlay', 'index.html'),
        },
        {
          label: 'overlay preload',
          path: resolve('bundled-app', 'dist', 'overlay', 'preload.cjs'),
        },
      ]);
    }
  });
});
