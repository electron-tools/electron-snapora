# electron-snapora — Electron向けスクリーンショット・注釈ツール

[![npm version](https://img.shields.io/npm/v/electron-snapora?style=flat-square&color=cb3837)](https://www.npmjs.com/package/electron-snapora)
[![npm total downloads](https://img.shields.io/npm/dt/electron-snapora?style=flat-square&color=blue)](https://www.npmjs.com/package/electron-snapora)
[![npm monthly downloads](https://img.shields.io/npm/dm/electron-snapora?style=flat-square&color=2088FF)](https://www.npmjs.com/package/electron-snapora)
[![CI Status](https://img.shields.io/github/actions/workflow/status/electron-tools/electron-snapora/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/electron-tools/electron-snapora/actions)
[![Electron Version](https://img.shields.io/badge/Electron-%3E%3D42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Zero Native Addons](https://img.shields.io/badge/Native%20Addons-0-success?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![License](https://img.shields.io/npm/l/electron-snapora?style=flat-square)](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/electron-tools/electron-snapora?style=flat-square)](https://github.com/electron-tools/electron-snapora/stargazers)

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | 日本語 | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

Electronアプリに範囲キャプチャ、インタラクティブな選択、画像注釈、クリップボードへのコピー、PNG保存を追加します。

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="electron-snapora preview" width="800" />
</p>

## 機能

- 矩形範囲のキャプチャとインタラクティブなオーバーレイ。
- 四角形、楕円、矢印、ブラシ、テキスト、強度調整可能なモザイク、ウォーターマーク注釈。
- 元に戻す、やり直し、クリップボードへのコピー、ネイティブPNG保存、画面への固定。
- TypeScript、ESM、CommonJSをサポート。
- ネイティブアドオンやインストール後のコンパイルは不要。

## クイックスタート

要件：Node.js 20以降、Electron 42以降。

### 1. インストール

```bash
npm install electron-snapora
```

本パッケージは本番用の `dependencies` に含めてください。

### 2. メインプロセスを設定

```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { setupElectronSnapora } from 'electron-snapora/main';

app.whenReady().then(() => {
  const snapora = setupElectronSnapora({ ipcMain });
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: snapora.preloadPath,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadFile('index.html');
  app.once('before-quit', snapora.unregister);
});
```

### 3. Rendererからキャプチャ

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  console.log(result.data, result.bounds, result.output);
}
```

`result.data` はPNGのバイトデータです。キャンセル時は `cancelled`、失敗時は `failed` が返ります。

## 既存のPreloadを使用する場合

アプリ独自のPreloadからAPIを公開し、そのPreloadをホスト側のビルドツールでバンドルしてください。

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

## パッケージング

Electronのメインプロセスをバンドルする際は `electron-snapora` をexternalにし、本番用依存関係に含めてください。これによりOverlayのHTML、CSS、Preloadファイルがアプリに同梱されます。

テーマ、ローカライズ、IPC送信元の検証、同時実行キュー、診断、各種バンドラー設定については[英語の完全版ドキュメント](https://github.com/electron-tools/electron-snapora/blob/main/README.md)を参照してください。

リポジトリ：[github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)

ライセンス：[MIT](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
