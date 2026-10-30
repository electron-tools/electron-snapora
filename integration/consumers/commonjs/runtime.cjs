const { existsSync, readdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { app, ipcMain } = require('electron');
const {
  resolveOverlayResources,
  setupElectronSnapora,
  createMacSnapProvider,
  createWindowsSnapProvider,
} = require('electron-snapora/main');

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
        `CommonJS consumer cannot resolve packaged resources: ${resources.join(', ')}`
      );
    }
    snapora.unregister();
    // Both module formats must expose providers from an installed package without demo files.
    const root = resolve(dirname(require.resolve('electron-snapora/main')), '../..');
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
      if (process.platform === 'darwin') await mac.prepare();
      if (process.platform === 'win32' && !(await windows.prepare()))
        throw new Error('Installed Windows executable could not start.');
    } finally {
      mac.dispose();
      windows.dispose();
    }
    console.log('Electron Snapora CommonJS consumer passed.');
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
