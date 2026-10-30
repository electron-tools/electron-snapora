import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      electron: fileURLToPath(
        new URL('./test/electron/electron-mock.ts', import.meta.url)
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
