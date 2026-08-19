import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url));
const overlayRoot = fileURLToPath(new URL('./src/overlay', import.meta.url));

export default defineConfig({
  root: overlayRoot,
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist/overlay', import.meta.url)),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/overlay/index.html', import.meta.url)),
    },
  },
  resolve: {
    alias: {
      '@core': `${repositoryRoot.replaceAll('\\', '/')}/src/core`,
    },
  },
});
