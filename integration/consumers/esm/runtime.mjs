import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { app, ipcMain } from 'electron';
import {
  resolveOverlayResources,
  setupElectronSnapora,
  createMacSnapProvider,
  createWindowsSnapProvider,
} from 'electron-snapora/main';

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const snapora = setupElectronSnapora({ ipcMain });
    const resources = [
      snapora.preloadPath,
      ...Object.values(resolveOverlayResources()),
    ];
    if (!resources.every((path) => existsSync(path))) {
      throw new Error(
        `ESM consumer cannot resolve packaged resources: ${resources.join(', ')}`
      );
    }
    snapora.unregister();
    // Check the installed tarball, not repository paths or demo-owned implementations.
    const root = resolve(
      dirname(createRequire(import.meta.url).resolve('electron-snapora/main')),
      '../..'
    );
    if (
      existsSync(resolve(root, 'demo')) ||
      readdirSync(resolve(root, 'dist/native')).some((name) =>
        /\.(cs|ps1|swift)$/.test(name)
      )
    )
      throw new Error(
        'The release must not depend on demo or native source compilation.'
      );
    for (const asset of [
      'snapora-windows-snap.exe',
      'snapora-windows-capture.exe',
      'windows-helpers.json',
    ])
      if (!existsSync(resolve(root, 'dist/native', asset)))
        throw new Error(`Missing runtime helper: ${asset}`);
    const mac = createMacSnapProvider({ granularity: 'panel' });
    const windows = createWindowsSnapProvider({ granularity: 'window' });
    try {
      if (typeof mac.getPermissions !== 'function')
        throw new Error('Missing public permission API.');
      if (process.platform === 'darwin') await mac.prepare(); // No permissions or pixels requested.
      if (process.platform === 'win32' && !(await windows.prepare()))
        throw new Error('Installed Windows executable could not start.');
    } finally {
      mac.dispose();
      windows.dispose();
    }
    console.log('Electron Snapora ESM consumer passed.');
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
