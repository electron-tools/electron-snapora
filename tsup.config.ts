import { defineConfig } from 'tsup';

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
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
});
