import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveHostPreloadPath, resolveOverlayResources } from './resource-paths.js';

describe('resolveOverlayResources', () => {
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
  });
});
