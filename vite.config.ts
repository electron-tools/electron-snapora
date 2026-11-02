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
      input: {
        overlay: fileURLToPath(new URL('./src/overlay/index.html', import.meta.url)),
        pinned: fileURLToPath(new URL('./src/overlay/pinned.html', import.meta.url)),
        recording: fileURLToPath(
          new URL('./src/overlay/recording.html', import.meta.url)
        ),
        recordingPreview: fileURLToPath(
          new URL('./src/overlay/recording-preview.html', import.meta.url)
        ),
        recordingDevices: fileURLToPath(
          new URL('./src/overlay/recording-devices.html', import.meta.url)
        ),
        camera: fileURLToPath(new URL('./src/overlay/camera.html', import.meta.url)),
        cameraControls: fileURLToPath(
          new URL('./src/overlay/camera-controls.html', import.meta.url)
        ),
      },
    },
  },
  resolve: {
    alias: {
      '@core': `${repositoryRoot.replaceAll('\\', '/')}/src/core`,
    },
  },
});
