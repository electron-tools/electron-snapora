# electron-snapora — Electron 截图与标注工具

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | 简体中文 | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

为 Electron 应用增加区域截图、交互式选区、图片标注、剪贴板复制和 PNG 保存能力。

## 功能

- 矩形区域截图和交互式截图层。
- 矩形、椭圆、箭头、画笔、文字和马赛克标注。
- 撤销、重做、剪贴板复制和原生 PNG 保存。
- 支持 TypeScript、ESM 和 CommonJS。
- 默认不依赖原生扩展，也不需要安装后编译。

## 快速开始

环境要求：Node.js 20 或更高版本、Electron `>=42 <44`。

### 1. 安装

```bash
npm install electron-snapora
```

请将它保留在应用的生产环境 `dependencies` 中。

### 2. 配置主进程

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

### 3. 在 Renderer 中截图

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  console.log(result.data, result.bounds, result.output);
}
```

`result.data` 是 PNG 字节数据。用户取消时返回 `cancelled`，处理失败时返回 `failed`。

## 已有 Preload 的应用

在应用自己的 Preload 中暴露 API，并保持该 Preload 由宿主构建工具打包：

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

## 打包说明

打包 Electron 主进程时，请将 `electron-snapora` 保持为 external，并确保它位于生产环境依赖中，这样 Overlay HTML、CSS 和 Preload 文件才会随应用一起安装。

主题、本地化、IPC 来源校验、并发队列、诊断和各类打包器配置请参阅[英文完整文档](https://github.com/electron-tools/electron-snapora/blob/main/README.md)。

仓库：[github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)

许可证：[MIT](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)
