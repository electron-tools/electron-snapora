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

## 1.0.26 への更新：ホスト側の設定

従来の静止画・単一画面キャプチャに新しい必須引数はありません。パッケージの更新だけではライブ選択や吸着は有効になりません。

| 目的 | ホスト側の設定 |
| --- | --- |
| 複数画面のライブ選択 | Windows 10 2004+ / macOS 14+ で `capture({ interactionMode: 'live', display: 'all' })` を呼び出します。非対応環境では `frozen` + `cursor` を使用します。 |
| 自動吸着 | メインプロセスで `createWindowsSnapProvider(...)` / `createMacSnapProvider(...)` を作成し、`setupElectronSnapora({ ipcMain, managerOptions: { getWindowSnapRegions: provider } })` に渡します。`ScreenshotManager` には直接 `{ getWindowSnapRegions: provider }` を渡します。provider がなければ手動選択のみ可能です。 |
| ウィンドウ全体だけに吸着 | provider に `{ granularity: 'window' }` を明示します。API の既定値は内部領域を選ぶ `panel`、さらに細かい設定は `fine` です。 |
| macOS の権限 | `macProvider.getPermissions()` で確認し、ユーザーの許可操作後に `getPermissions(true)` を呼び、再確認します。live キャプチャには画面収録、AX コンテナーにはアクセシビリティ権限が必要です。両方の許可をすべてのキャプチャの条件にする場合は、ホスト側で制御してください。ライブラリはその制限や許可 UI を自動提供しません。 |
| アプリの配布 | `node_modules/electron-snapora/dist/native/**` を ASAR の外に展開し、ホスト側で署名します。標準 npm 配置では helper パスの指定は不要です。移動する場合は後述の `extraResources` 設定を参照してください。 |

provider はメインプロセスで一度作成して再利用し、終了時に `dispose()` を呼びます。`prepare()` は任意の事前起動です。demo オブジェクト、DOM、ウィンドウ一覧、権限の真偽値を渡す必要はありません。詳細な接続・権限ブリッジ・署名の例は後述のライブ選択セクションにあります。

## 主な機能

- Windows 10 2004+ / macOS 14+ の複数画面ライブ選択。範囲を確定してから画像を取得します。
- Windows UI Automation / macOS AX によるアプリ間のウィンドウ・コンテナー吸着。`window / panel / fine` の3段階。
- ホスト向け macOS 権限照会、明示的な許可要求、構造化されたエラー結果。
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

対応言語は英語（`en-US`、既定）、簡体字中国語（`zh-CN`）、日本語（`ja-JP`）、韓国語（`ko-KR`）、スペイン語（`es-ES`）です。言語リソースは `src/i18n` にあります。

コピー完了の通知は既定では無効です。`showCopyFeedback: true` で有効にすると、白い背景、黒い文字、薄緑の枠線、緑のチェックマークで 3 秒間表示されます。ライト・ダークの両テーマで同じ配色です。文言は `messages.copied`、色は以下の `copyFeedback*` フィールドで変更できます。

```ts
await window.electronSnapora.capture({
  locale: 'ja-JP',
  showCopyFeedback: true,
  messages: { copied: 'クリップボードにコピーしました' },
  theme: {
    mode: 'dark',
    accentColor: '#0a84ff',
    copyFeedbackBackground: '#ffffff',
    copyFeedbackForeground: '#111111',
    copyFeedbackBorderColor: '#dff3eb',
    copyFeedbackIconColor: '#20b88a',
    copyFeedbackIconBackground: '#e4f8ef',
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

## 複数画面のライブ選択・コンテナー吸着・権限

これらは npm パッケージの公開 API です。`demo/` はソースリポジトリの検証アプリで、npm には含まれません。既定の統合は静止画像による単一画面キャプチャのままです。パッケージのインストールだけでは吸着 provider や権限 UI は登録されません。

`interactionMode: 'live'` は画面間のポインター移動、ホバー吸着、クリック選択、自由なドラッグ選択に対応します。ドラッグは開始した画面内に限定され、確定後にその画面を取得して既存エディターを開きます。`display: 'all'` は live 専用で、複数画面を1枚に合成する指定ではありません。従来モードは `interactionMode: 'frozen', display: 'cursor'` です。

| 粒度            | 動作                                                                             |
| --------------- | -------------------------------------------------------------------------------- |
| `window`        | ウィンドウ全体。アクセシビリティツリーは走査しません。                           |
| `panel`（provider API の既定） | 主なレイアウト領域とサイドバー。小さなコントロールや入れ子のカードを除外します。 |
| `fine`          | カードやリスト項目など、公開されている小さなコンテナー。                         |

Windows は UI Automation、macOS は CoreGraphics の境界、AX、ScreenCaptureKit を利用します。両 provider は `prepare()` / `dispose()` を持ち、ウィンドウを先に、コンテナーを後から通知します。Mac のシステム合成・状態表示レイヤーはヒットテストと遮蔽判定から除外し、実際の全画面アプリは保持します。Canvas や独自描画ではウィンドウ単位に限定される場合があります。live は Windows build 19041+ または macOS 14+ が必要です。Linux の live は未対応です。

### ホストのメインプロセス

`app.whenReady()` の完了後、下記の preload を指定してホストウィンドウを作成し、ページを読み込む前に `setupHostScreenshot(hostWindow, trustedUrl)` を呼び出します。信頼する完全な `file://` URL または開発 URL を渡し、レンダラー初期化前に IPC を登録します。前述の `setupElectronSnapora()` 初期化を置き換え、同じ IPC を重複登録しないでください。返された関数をウィンドウ終了・アプリ終了時に呼び出してください。複数のホストウィンドウでは manager/provider を共有し、許可する各送信元を検証します。

```ts
import { release } from 'node:os';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import {
  setupElectronSnapora,
  createMacSnapProvider,
  createWindowsSnapProvider,
} from 'electron-snapora/main';

export function setupHostScreenshot(hostWindow: BrowserWindow, trustedUrl: string) {
  const liveSupported =
    (process.platform === 'win32' && Number(release().split('.')[2]) >= 19041) ||
    (process.platform === 'darwin' && Number(release().split('.')[0]) >= 23);
  const macProvider =
    process.platform === 'darwin' && liveSupported
      ? createMacSnapProvider({ granularity: 'panel', onDiagnostic: console.info })
      : undefined;
  const provider =
    macProvider ??
    (process.platform === 'win32' && liveSupported
      ? createWindowsSnapProvider({ granularity: 'panel', keepAlive: true })
      : undefined);
  const validateSender = (event: IpcMainInvokeEvent) =>
    !hostWindow.isDestroyed() &&
    event.sender === hostWindow.webContents &&
    event.senderFrame === hostWindow.webContents.mainFrame &&
    event.senderFrame?.url === trustedUrl;

  const snapora = setupElectronSnapora({
    ipcMain,
    validateSender,
    managerOptions: { getWindowSnapRegions: provider },
  });
  ipcMain.handle('host:snapora-permissions', async (event, prompt: unknown) => {
    if (!validateSender(event) || typeof prompt !== 'boolean')
      throw new Error('Unauthorized permission request.');
    if (snapora.manager.activeJobId)
      throw new Error('Finish or cancel the current capture first.');
    return {
      liveSupported,
      macPermissions: macProvider ? await macProvider.getPermissions(prompt) : null,
    };
  });

  return () => {
    ipcMain.removeHandler('host:snapora-permissions');
    snapora.unregister();
    provider?.dispose();
  };
}
```

### Preload とレンダラー

以下を単一の CommonJS preload にバンドルし、出力の絶対パスを `BrowserWindow.webPreferences.preload` に指定します。`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` を維持します。preload の `electron-snapora/preload` はバンドルに含め、`electron` だけを external にします。メインプロセスのパッケージは external のままです。[Electron のサンドボックス説明](https://www.electronjs.org/docs/latest/tutorial/sandbox)を参照してください。

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
contextBridge.exposeInMainWorld('snaporaPermissions', {
  get: () => ipcRenderer.invoke('host:snapora-permissions', false),
  request: () => ipcRenderer.invoke('host:snapora-permissions', true),
});
```

`host:snapora-permissions` と `window.snaporaPermissions` はホスト独自のサンプル API であり、パッケージの組み込み API ではありません。レンダラー用の型宣言を追加してください。`get()` は `{ liveSupported, macPermissions: null | { screenRecording, accessibility } }` を返し、`null` は対応する Mac provider がないことを示します。照会失敗は IPC の reject で通知され、許可拒否とは分けて表示します。

```ts
import type { MacSnapPermissions } from 'electron-snapora/main';
import type { ScreenshotRendererApi } from 'electron-snapora/types';

interface HostPermissionState {
  liveSupported: boolean;
  macPermissions: MacSnapPermissions | null;
}
declare global {
  interface Window {
    electronSnapora: ScreenshotRendererApi;
    snaporaPermissions: {
      get(): Promise<HostPermissionState>;
      request(): Promise<HostPermissionState>;
    };
  }
}
```

```ts
const state = await window.snaporaPermissions.get();
const result = await window.electronSnapora.capture({
  interactionMode: state.liveSupported ? 'live' : 'frozen',
  display: state.liveSupported ? 'all' : 'cursor',
});
if (result.status === 'failed' && result.code === 'PERMISSION_DENIED') {
  console.info(result.message);
}
```

### 権限とホストの責任

| 状態                          | パッケージの動作                                                                                 | ホストの対応                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 画面収録が未許可              | live の `capture()` は `status: 'failed', code: 'PERMISSION_DENIED'` を既存 IPC 経由で返します。 | 説明と許可・設定への導線を表示。                                                        |
| アクセシビリティが未許可      | ウィンドウ吸着・自由選択へ縮退。撮影成功は AX 許可を意味しません。                               | `getPermissions()` または provider の `onDiagnostic` の `accessibility: false` を確認。 |
| helper が存在しない・起動不可 | 照会は reject。撮影は `CAPTURE_FAILED` になる場合があります。                                    | パス・同梱・署名を修正。許可拒否として扱わない。                                        |

`macProvider.getPermissions()` は実際の helper を照会し、ダイアログを開きません。ユーザーが許可ボタンを押したときだけ `window.snaporaPermissions.request()` を呼びます。これは `getPermissions(true)` に対応し、画面収録とアクセシビリティを要求します。設定操作の完了を待つ API ではないため、後で再照会し、必要なら署名済みアプリを再起動します。`false` は未要求・拒否・制限を区別しません。撮影中には要求しないでください。

権限変更の自動プッシュや組み込みレンダラーブリッジはありません。UI、IPC の検証・解除、状態更新はホストが管理します。live は native backend の権限を基準にし、Electron ホストの状態だけでは判断しません。frozen は従来の Electron 権限確認を維持し、拒否済みなら画面収録設定を開きます。通常の撮影・吸着にマイク、カメラ、入力監視、フルディスクアクセス、自動化は不要です。demo の AppleScript によるフォーカス復元フォールバックだけは自動化を要求する場合があり、製品の必須依存ではありません。

### Mac helper の配布

パッケージを production `dependencies` に配置し、メインエントリーを external にします。リリースには **arm64 + x86_64 universal** の `dist/native/snapora-macos` が必要です。利用者のマシンに Swift、Xcode、`koffi`、demo は不要です。helper は別プロセスであり、Node native addon ではありません。

リポジトリと同じ **electron-builder 26** では次のように展開します。

```json
{
  "build": {
    "asarUnpack": ["node_modules/electron-snapora/dist/native/**"]
  }
}
```

Windows にはビルド済みの `dist/native/snapora-windows-snap.exe`（UI Automation）と `dist/native/snapora-windows-capture.exe`（画面取得）を同梱します。Electron が直接起動するため、実行時の PowerShell、C# コンパイル、ダウンロード、一時 exe の生成は不要です。Windows の .NET Framework ランタイムを使用する AnyCPU プログラムであり、自己完結型 .NET 配布ではありません。利用者にコンパイラーや SDK は不要です。両方を ASAR の外に展開し、HTML/CSS/JS は ASAR 内に残せます。

Windows での `pnpm run build` / `pnpm demo` は先に helper をコンパイルします。個別ビルドは `pnpm run build:native:windows`、成果物とソースの整合性確認は `pnpm run verify:native:windows` です。API、事前起動、再利用、キャンセル、3 段階の吸着、画像編集機能は変わりません。

macOS/Linux で公開する場合は、同じリビジョンを Windows でビルドし、2 個の exe と `windows-helpers.json` を公開マシンの `src/electron/native` にコピーしてください。CI の成果物名は `windows-native-helpers` です。`release:check` は Windows と Mac universal の成果物を要求し、Windows ファイルの欠落・破損・古いソースを拒否します。C#/PowerShell/Swift ソースは npm に含めません。Windows helper の製品署名はホストのパッケージ工程で行えます。

既定の探索は `app.asar` を `app.asar.unpacked` に置換します。実行権限を維持し、ホストの Developer ID 署名・公証に helper を含めます。開発用 ad-hoc 署名は製品署名ではありません。[builder 26](https://www.electron.build/v26/docs/mac/) の `mac.binaries` は追加実行ファイルの署名に利用できます。builder 27 では `asar.unpack` と `mac.sign`、Forge でも相応の展開・署名設定が必要です。

`extraResources` を使う場合は同じ絶対パスを `createMacSnapProvider({ executablePath })` と `new ElectronCaptureAdapter({ macHelperPath })` に設定し、adapter を `managerOptions.captureAdapter` に渡します。注入した adapter は manager/provider と別にホストが `dispose()` します。権限は最終的な署名済みアプリで検証してください。

### ソース demo とリリース検証

開発時は `pnpm demo`（別名 `pnpm run demo:mac`）。macOS 14+ では helper を先にビルドするため、ビルド環境に Xcode Command Line Tools が必要です。demo の既定は live + window（ウィンドウ全体）。panel / fine に切り替えて比較できます。パッケージは demo の権限 IPC やフォーカス復元を参照しません。

公開前に Mac で実行します。

```bash
pnpm run test:native:mac
pnpm run build:native:mac:universal
pnpm run release:check
```

`release:check` は helper の欠落、単一アーキテクチャ、不正な構造を拒否し、Mac では実行権限と署名も確認します。`dist/native` にはビルド済み helper と検証情報のみをコピーし、C#/PowerShell/Swift ソースは含めません。CI は Windows 成果物、Mac の Swift 回帰、universal 成果物、実際の tgz からインストールした ESM/CommonJS 利用例を検証します。

システムウィンドウの除外後、ユーザーから Mac demo の撮影・吸着が動作するとの報告を得ています。署名済み配布、両 CPU の実機、Lark/ブラウザー/Ping の全組み合わせは引き続きリリース検証が必要です。[実装・検証記録](https://github.com/electron-tools/electron-snapora/blob/main/docs/macos-container-snap.md)。

## ライセンスと商標

ソースコードは [MIT License](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE) に基づいて提供されます。`electron-snapora` の名称とブランドは [商標ポリシー](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md) に準拠します。
