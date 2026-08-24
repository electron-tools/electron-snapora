# electron-snapora — Electron 截图插件与标注工具

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | 简体中文 | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

一个易于接入的 Electron 截图插件，通过一步初始化和安全 Preload IPC 提供区域截图、交互式选区、图片标注、剪贴板复制、PNG 导出和固定到屏幕能力。

## 功能

- 矩形区域截图和交互式截图层。
- 矩形、椭圆、箭头、画笔、文字、可调强度马赛克和全区水印标注，并提供上下文预设面板。
- 保持当前绘图工具时，可直接拖动已有标注；点击空白区域继续绘制。
- 撤销、重做、剪贴板复制、原生 PNG 保存和固定到屏幕。
- 固定截图支持等比缩放，并在关闭前持续保持最高置顶层级。
- 支持 TypeScript、ESM 和 CommonJS。
- 默认不依赖原生扩展，也不需要安装后编译。

支持与反馈：[GitHub Issues](https://github.com/electron-tools/electron-snapora/issues) · [@novratools on X](https://x.com/novratools)

商标政策：[TRADEMARKS.md](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)

## 问题反馈

如果说明不清晰或功能与预期不符，请先搜索[现有 Issues](https://github.com/electron-tools/electron-snapora/issues)。没有相同问题时，可以创建[新的 GitHub Issue](https://github.com/electron-tools/electron-snapora/issues/new)，也可以通过 [@novratools on X](https://x.com/novratools) 联系项目。

建议在 Bug 报告中提供：

- `electron-snapora`、Electron、Node.js 和操作系统版本；
- 最小复现步骤，以及尽可能精简的复现项目；
- 预期行为和实际行为；
- 相关错误、日志、截图或录屏，并提前移除 Token、账号和其他隐私数据。

涉及安全或隐私的问题时，不要在公开 Issue 中粘贴凭证、私密截图、Token 或机密日志。请先通过 X 联系，再使用双方确认的私密渠道提供细节。

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

截图完成并复制后的独立提示窗口默认关闭；宿主需要时，可在本次截图中传入 `showCopyFeedback: true`。

截图选区始终使用自由拖拽框选，窗口吸附和自动贴合行为已关闭，以保证不同宿主与桌面平台上的操作一致。

截图工具栏中的竖向图钉按钮会把最终图片固定到当前选区位置。每张固定图片都是独立的无边框窗口，关闭前持续保持最高标准置顶层级，可以整体拖动，并按原图比例缩放；最小宽高均为 176px，保证右键菜单保留安全边距。右上角圆形关闭按钮仅在鼠标进入窗口后显示。右键点击图片可通过固定宽度、统一单色图标的菜单选择复制、保存或关闭，复制成功会在当前固定窗口内显示本地化提示，并且可以同时固定多张截图。菜单会复用创建该固定截图时传入的 `locale` 和 `messages.copy/save/close`；宿主切换语言后，新创建的固定截图会立即跟随，已经存在的固定窗口保持创建时语言。

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

## 许可证与商标

源码使用 [MIT License](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)。`electron-snapora` 名称和官方项目品牌另受[商标政策](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)约束。MIT 仍允许修改和分发代码，但修改版本不得冒充官方发布，也不得以容易混淆的方式使用官方名称或品牌。
