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

## macOS のショートカットとホストウィンドウの保護

キャプチャを開始するグローバルショートカットはホストが登録します。キャプチャ画面内の Escape、R（矩形）、T（テキスト）などは Snapora が処理します。macOS では、オーバーレイの表示時にフォーカス可能な状態を復元し、アプリ、ウィンドウ、Web コンテンツのフォーカスを要求します。ホストが同じフォーカス操作を重複して行ったり、Escape/R/T をグローバルショートカットとして登録したりする必要はありません。

**ホストウィンドウの保護は必須設定ではありません。** 既存のフォーカス管理やバックグラウンドウィンドウの前面化を防ぐ処理がある場合は、次の規則に従ってください。

- 明示的なウィンドウ参照、またはホストが管理するコレクションを使い、ホスト自身のウィンドウだけを操作してください。`BrowserWindow.getAllWindows()` の全ウィンドウに `setFocusable(false)` を適用しないでください。この一覧には、次回のキャプチャで再利用される非表示のオーバーレイも含まれます。オーバーレイ、固定画像、コピー通知の各ウィンドウを対象から除外してください。
- macOS 専用の保護処理は `process.platform === 'darwin'` 分岐内に限定し、Windows の動作を変えないでください。アプリのアクティブ状態は `app.isActive()` で確認します。設定や会議のウィンドウにフォーカスがある場合も、メインウィンドウの状態にかかわらずホストはアクティブです。
- ウィンドウの状態を変更する前に `manager.activeJobId` を確認してください。`capture()` の外側で非同期にフォーカスを復元する場合は、キャプチャから復元完了までの処理全体で重複実行を防いでください。
- 元の状態を記録し、キャンセルや失敗の場合も `finally` で復元してください。今回変更した、まだ破棄されていないウィンドウだけを復元します。前回の遅延コールバックが次回のキャプチャ状態を変更しないようにしてください。

Snapora はキャプチャ終了時に `app.hide()` を呼びません。これはホストや固定画像を含むアプリの全ウィンドウを非表示にするためです。ホストウィンドウのフォーカスは、キャプチャ開始前にそのウィンドウがフォーカスされていた場合にのみ復元します。以前アクティブだった外部アプリへ戻すかどうかはホスト側の方針であり、Snapora は外部アプリの自動復元機能を提供しません。`app.hide()` を汎用的な終了処理に使わないでください。

オーバーレイが見えてもキーが反応しない場合は、`app.isActive()`、オーバーレイの `isFocusable()` と `isFocused()`、`webContents.isFocused()`、`before-input-event` の到達を確認してください。画面が見えるだけではキーボードフォーカスを確認できず、その WebContents に届かないキーは `before-input-event` でも受信できません。初回は動作しても2回目に失敗する場合は、再利用するオーバーレイのフォーカスをホストが無効にしていないか確認してください。実機の Mac で別のアプリを前面にした状態から初回と連続キャプチャを検証してください。フォーカス API の呼び出しだけでは入力の到達は保証されません。

## エラーコード一覧

| エラーコード              | 内容                                   |
| :------------------------ | :------------------------------------- |
| `CAPTURE_BUSY`            | 実行中タスクまたはキューが満杯です。   |
| `INVALID_REQUEST`         | リクエストの検証に失敗しました。       |
| `RESOURCE_LIMIT_EXCEEDED` | 許容サイズを超過しました。             |
| `PERMISSION_DENIED`       | 画面録画権限が拒否されました。         |
| `DISPLAY_NOT_FOUND`       | 対象ディスプレイが見つかりません。     |
| `CAPTURE_FAILED`          | キャプチャに失敗しました。             |
| `OVERLAY_LOAD_FAILED`     | オーバーレイの読み込みに失敗しました。 |
| `EXPORT_FAILED`           | 画像出力または保存に失敗しました。     |
| `INVALID_RESULT`          | 不正な結果データです。                 |
| `UNSUPPORTED_PLATFORM`    | 非対応プラットフォームです。           |

## ライセンスと商標

ソースコードは [MIT License](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE) に基づいて提供されます。`electron-snapora` の名称とブランドは [商標ポリシー](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md) に準拠します。
