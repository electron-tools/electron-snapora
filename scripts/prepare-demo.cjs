// Build the native backend for supported Macs before the JS build copies its assets.
// Other platforms (including older Macs using frozen capture) need no Swift toolchain.
const { release } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform === 'darwin' && Number(release().split('.')[0]) >= 23) {
  console.log('Preparing macOS capture helper (requires Xcode Command Line Tools)…');
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'build-native-mac.mjs')],
    {
      stdio: 'inherit',
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(
      'macOS helper build failed; demo was not started. Check the compiler output above.'
    );
    process.exitCode = result.status || 1;
  }
}
