import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/electron-vite',
      rollupOptions: {
        input: resolve('main.mjs'),
        external: [/^electron-snapora(?:\/.*)?$/],
        output: {
          format: 'cjs',
          entryFileNames: 'main.cjs',
        },
      },
    },
  },
});
