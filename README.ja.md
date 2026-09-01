# electron-snapora — Electron向けスクリーンショット・注釈ツール

[![npm version](https://img.shields.io/npm/v/electron-snapora?style=flat-square&color=cb3837)](https://www.npmjs.com/package/electron-snapora)
[![npm total downloads](https://img.shields.io/npm/dt/electron-snapora?style=flat-square&color=blue)](https://www.npmjs.com/package/electron-snapora)
[![npm monthly downloads](https://img.shields.io/npm/dm/electron-snapora?style=flat-square&color=2088FF)](https://www.npmjs.com/package/electron-snapora)
[![License](https://img.shields.io/npm/l/electron-snapora?style=flat-square)](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![Modules](https://img.shields.io/badge/Modules-ESM%20%7C%20CJS-informational?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![Electron Version](https://img.shields.io/badge/Electron-%3E%3D42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Zero Native Addons](https://img.shields.io/badge/Native%20Addons-0-success?style=flat-square)](https://github.com/electron-tools/electron-snapora)
[![CI Status](https://img.shields.io/github/actions/workflow/status/electron-tools/electron-snapora/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/electron-tools/electron-snapora/actions)

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | 日本語 | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

1行のセットアップと安全なPreload IPCで、範囲キャプチャ、インタラクティブな注釈編集、クリップボードコピー、PNG保存、画面ピン留め小窓機能を提供するElectronスクリーンショットライブラリです。

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="electron-snapora preview" width="800" />
</p>

## 主な機能

- **範囲スクリーンショット**：ディスプレイ指定またはカーソル位置による画面キャプチャ。
- **インタラクティブな選択オーバーレイ**：自由ドラッグ選択、8方向のリサイズハンドル。
- **豊富な注釈ツール**：四角形、楕円、矢印、ブラシ、テキスト（通常/背景塗り/縁取りプリセット）、強度調整可能なモザイク、全画面ウォーターマーク。
- **快適な操作性**：描画ツールが有効なまま、既存の注釈を直接ドラッグして移動可能。
- **出力とピン留め**：クリップボードコピー、ネイティブPNG保存、最前面ピン留めウィンドウ作成。
- **等比スケーリング可能なピン留めウィンドウ**：常に最前面表示、等比ドラッグリサイズ、右クリックメニュー。
- **TypeScript、ESM、CommonJS対応**：完全な型定義を同梱。
- **ゼロネイティブ拡張（Zero Native Addons）**：C++ネイティブモジュール不要、インストール後コンパイルなし。

リポジトリ：[github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)  
サポート：[GitHub Issues](https://github.com/electron-tools/electron-snapora/issues) · [@novratools on X](https://x.com/novratools)  
商標ポリシー：[TRADEMARKS.md](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)

## クイックスタート

**最小要件：** Electron 42以降、Node.js 20以降。

### 1. インストール

```bash
npm install electron-snapora
```

ホストアプリにElectronが未インストールの場合は追加：

```bash
npm install --save-dev electron
```

### 2. メインプロセスでの初期化

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

### 3. レンダラープロセスからの呼び出し

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  console.log(result.data, result.bounds, result.output);
}
```

キャンセル時は `cancelled`、失敗時は `failed` を返します。

同一レンダラーから進行中のキャプチャタスクをキャンセルする場合：

```ts
await window.electronSnapora.cancel();
```

TypeScript型定義：

```ts
import type { ScreenshotRendererApi } from 'electron-snapora/types';

declare global {
  interface Window {
    electronSnapora: ScreenshotRendererApi;
  }
}
```

## 既存のPreloadを使用する場合

独自のPreloadを使用する場合は `snapora.preloadPath` を無視し、Preloadスクリプト内でAPIを公開してください：

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

## 送信元オリジンの検証

```ts
const snapora = setupElectronSnapora({
  ipcMain,
  validateSender(event) {
    const senderUrl = event.senderFrame?.url;
    if (!senderUrl) return false;

    const url = new URL(senderUrl);
    return (
      url.protocol === 'app:' ||
      (process.env.NODE_ENV === 'development' && url.origin === 'http://localhost:5173')
    );
  },
});
```

## 高度な設定

### テーマとローカライズ

```ts
await window.electronSnapora.capture({
  locale: 'ja-JP',
  theme: {
    mode: 'dark',
    accentColor: '#0a84ff',
  },
});
```

### リソース制限

```ts
const snapora = setupElectronSnapora({
  ipcMain,
  managerOptions: {
    resourceLimits: {
      maxCapturePixels: 32 * 1024 * 1024,
      maxCaptureDataUrlBytes: 96 * 1024 * 1024,
      maxOutputBytes: 32 * 1024 * 1024,
    },
  },
});
```

## バンドルとパッケージング

メインプロセスをバンドルする際は `electron-snapora` を external に設定してください（electron-vite、Webpack、electron-builder、Forgeに対応）。

## エラーコード一覧

| エラーコード | 内容 |
| :--- | :--- |
| `CAPTURE_BUSY` | 実行中タスクまたはキューが満杯です。 |
| `INVALID_REQUEST` | リクエストの検証に失敗しました。 |
| `RESOURCE_LIMIT_EXCEEDED` | 許容サイズを超過しました。 |
| `PERMISSION_DENIED` | 画面録画権限が拒否されました。 |
| `DISPLAY_NOT_FOUND` | 対象ディスプレイが見つかりません。 |
| `CAPTURE_FAILED` | キャプチャに失敗しました。 |
| `OVERLAY_LOAD_FAILED` | オーバーレイの読み込みに失敗しました。 |
| `EXPORT_FAILED` | 画像出力または保存に失敗しました。 |
| `INVALID_RESULT` | 不正な結果データです。 |
| `UNSUPPORTED_PLATFORM` | 非対応プラットフォームです。 |

## ライセンスと商標

ソースコードは [MIT License](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE) に基づいて提供されます。`electron-snapora` の名称とブランドは [商標ポリシー](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md) に準拠します。
