import { defineConfig } from 'tsup';
import { cp, mkdir } from 'node:fs/promises';

export default defineConfig({
  entry: {
    'main/index': 'src/main.ts',
    'preload/index': 'src/preload.ts',
    'preload/auto': 'src/electron/preload/auto-preload.ts',
    'overlay/preload': 'src/electron/preload/overlay-preload.ts',
    'pinned/preload': 'src/electron/preload/pinned-preload.ts',
    'core/index': 'src/core.ts',
    'types/index': 'src/types.ts',
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  target: 'node20',
  platform: 'node',
  dts: true,
  shims: true,
  sourcemap: true,
  clean: false,
  splitting: false,
  external: ['electron'],
  async onSuccess() {
    await mkdir('dist/native', { recursive: true });
    // Ship executable helpers only; all native sources are compiled on build machines.
    await cp('src/electron/native', 'dist/native', {
      recursive: true,
      filter: (source) => !/\.(?:swift|cs|ps1)$/.test(source),
    });
  },
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
});
