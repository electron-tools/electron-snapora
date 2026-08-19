const path = require('node:path');

module.exports = {
  mode: 'production',
  target: 'electron-main',
  entry: path.resolve('main.mjs'),
  output: {
    path: path.resolve('out/webpack'),
    filename: 'main.cjs',
    library: { type: 'commonjs2' },
  },
  externals: {
    'electron-snapora/main': 'commonjs electron-snapora/main',
  },
};
