# electron-snapora — Electron 截图插件与标注工具

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | 简体中文 | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

一个易于接入的 Electron 截图插件，通过一步初始化和安全 Preload IPC 提供区域截图、交互式选区、图片标注、剪贴板复制、PNG 导出和固定到屏幕能力。

## 功能

- 矩形区域截图和交互式截图层。
- 矩形、椭圆、箭头、画笔、文字、可调强度马赛克和全区水印标注，并提供上下文预设面板。
- 撤销、重做、剪贴板复制、原生 PNG 保存和固定到屏幕。
- 支持 TypeScript、ESM 和 CommonJS。
- 默认不依赖原生扩展，也不需要安装后编译。

联系与更新：[@novratools on X](https://x.com/novratools)

## 快速开始

**Electron 最低版本：** Electron 42。同时需要 Node.js 20 或更高版本。

### 1. 安装

```bash
npm install electron-snapora
```

Electron 由宿主应用提供。如果项目还没有安装 Electron：

```bash
npm install --save-dev electron
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

开始框选前，鼠标悬停到当前 Electron 应用内的可见窗口会预览其边界；单击即可选择完整窗口，拖动 4px 以上则切回自由框选。Electron 不直接提供外部应用窗口坐标，宿主可通过 `managerOptions.getWindowSnapRegions` 接入系统原生窗口枚举。

截图工具栏中的竖向图钉按钮会把最终图片固定到当前选区位置。每张固定图片都是独立的置顶无边框窗口，可以整体拖动、点击置前；右上角圆形关闭按钮仅在鼠标进入窗口后显示。右键点击图片可通过固定宽度、统一单色图标的菜单选择复制、保存或关闭，复制成功会在当前固定窗口内显示本地化提示，并且可以同时固定多张截图。菜单会复用创建该固定截图时传入的 `locale` 和 `messages.copy/save/close`；宿主切换语言后，新创建的固定截图会立即跟随，已经存在的固定窗口保持创建时语言。

macOS 10.15 及以上首次截图会由真实采集请求触发系统屏幕录制授权弹窗；如果用户已经拒绝，Snapora 会打开“系统设置 → 隐私与安全性 → 屏幕录制”并返回 `PERMISSION_DENIED`，授权后需要重启宿主应用。

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
