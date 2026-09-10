# electron-snapora — Electron 截图插件与标注工具

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

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | 简体中文 | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

一个开箱即用、易于集成的 Electron 屏幕截图插件。通过一步初始化和安全的 Preload IPC，提供区域框选截屏、交互式标注编辑、剪贴板复制、PNG 导出以及贴图置顶图钉窗口等完整能力。

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="electron-snapora preview" width="800" />
</p>

## 功能特性

- **跨平台屏幕截取**：支持显示器与光标定位截屏。
- **交互式选区覆盖层**：支持自由拖拽框选、8 方向尺寸调整与坐标指示。
- **丰富的上下文标注预设**：矩形、椭圆、箭头、画笔涂鸦、文字（普通/背景色块/描边预设）、强度可调马赛克和全屏平铺水印。
- **流畅的操作体验**：在标注工具激活状态下，可直接拖动已有标注调整位置，无需来回切换工具；点击空白区域继续绘制。
- **输出与贴图**：一键复制到剪贴板、原生保存 PNG 文件，以及创建置顶贴图小窗。
- **等比缩放贴图小窗**：贴图窗口置顶显示、支持自由等比拖拽缩放、右键菜单快捷操作。
- **现代工程支持**：原生 TypeScript 类型，同时支持 ESM 和 CommonJS 规范。
- **零原生扩展依赖**：默认不依赖 C++ 原生模块（0 Native Addons），无需额外 node-gyp 编译。

代码仓库：[github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)  
技术支持：[GitHub Issues](https://github.com/electron-tools/electron-snapora/issues) · [@novratools on X](https://x.com/novratools)  
商标政策：[TRADEMARKS.md](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)

## 支持与问题反馈

如果遇到问题或行为不及预期，请先检索 [已有 Issues](https://github.com/electron-tools/electron-snapora/issues)。若未找到匹配项，请提交 [新的 GitHub Issue](https://github.com/electron-tools/electron-snapora/issues/new) 或在 X 上联系 [@novratools](https://x.com/novratools)。

有效的 Bug 报告建议包含：

- `electron-snapora`、Electron、Node.js 版本以及操作系统环境；
- 最小复现步骤或最小复现工程；
- 预期行为与实际表现；
- 脱敏后的相关错误日志、截图或录屏。

涉及安全或隐私的问题时，请勿在公开 Issue 中包含凭证或敏感数据。

## 快速上手

**最低 Electron 版本：** Electron 42。同时要求 Node.js 20 或更高版本。

### 1. 安装依赖

```bash
npm install electron-snapora
```

如果宿主工程尚未安装 Electron：

```bash
npm install --save-dev electron
```

请确保将本包保存在宿主工程生产依赖 `dependencies` 中，打包后的应用程序运行时需要加载其中的 UI 界面与 Preload 脚本。

### 2. 主进程初始化

使用 `setupElectronSnapora()` 一键创建截图管理器、注册安全 IPC，并为窗口提供开箱即用的 Preload 路径：

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

打包 Electron 主进程时，请将 `electron-snapora` 设为外部依赖（external），确保其自带的 HTML、CSS 和 Preload 资源与库入口保持在同级目录。详见 [构建与打包配置](#构建与打包配置)。

### 3. 渲染进程调用

在渲染进程中直接调用注入的 API：

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  // 返回生成的 PNG 二进制数据、选区几何信息与输出方式
  console.log(result.data, result.bounds, result.output);
}
```

截图覆盖层允许用户框选区域，绘制矩形、椭圆、箭头、画笔、文字、马赛克或平铺水印，随后复制、保存或固定置顶 PNG。按 `Escape` 可取消截图。返回值结构始终为 `completed`、`cancelled` 或 `failed`，调用方无需使用异常捕获即可平滑处理用户常规操作。

从同一渲染进程取消正在进行的截图任务：

```ts
await window.electronSnapora.cancel();
```

如需 TypeScript 类型提示，可在宿主工程的类型定义文件中声明一次：

```ts
import type { ScreenshotRendererApi } from 'electron-snapora/types';

declare global {
  interface Window {
    electronSnapora: ScreenshotRendererApi;
  }
}
```

## 已有 Preload 脚本的应用集成

如果宿主工程已有自己的 Preload 脚本，可忽略 `snapora.preloadPath`，直接在自己的 Preload 构建中暴露 API：

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

开启沙箱的 Preload 脚本无法在运行时动态加载未打包的 npm 模块，因此已有 Preload 需参与打包。未配置独立 Preload 的工程直接使用快速开始提供的 `snapora.preloadPath` 即可。

## 自定义页面来源与安全校验

默认情况下，截图 IPC 出于安全考虑仅接受通过 `BrowserWindow.loadFile()` 加载的顶层页面请求，并严格拒绝所有 iframe 调用。如果宿主应用使用自定义协议或本地开发服务器，可配置明确的白名单验证：

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

Snapora 在主进程还会对截图参数进行二次校验，传入未知或非法参数时会在调用底层截屏前直接返回 `INVALID_REQUEST`。

## 包入口点说明

大多数应用只需引用 `electron-snapora/main` 与注入的 `window.electronSnapora`。其他子入口提供给高级集成场景使用：

```ts
import { setupElectronSnapora } from 'electron-snapora/main';
import { exposeScreenshotApi } from 'electron-snapora/preload';
import { normalizeRect } from 'electron-snapora/core';
```

## 高级配置

### 截图后复制提示

截图完成并复制到剪贴板后的独立提示窗口默认关闭，传入 `showCopyFeedback: true` 开启后显示 3 秒。提示默认采用白底黑字、浅绿色边框和绿色对号，深浅主题下保持一致。文案和颜色可以自定义：

```ts
await window.electronSnapora.capture({
  display: 'cursor',
  showCopyFeedback: true,
  messages: { copied: '已复制到剪贴板' },
  theme: {
    copyFeedbackBackground: '#ffffff',
    copyFeedbackForeground: '#111111',
    copyFeedbackBorderColor: '#dff3eb',
    copyFeedbackIconColor: '#20b88a',
    copyFeedbackIconBackground: '#e4f8ef',
  },
});
```

### 主题与国际化本地化

截图层默认采用英文界面（`en-US`）与深色工具栏。内置语言依次为英语（`en-US`）、简体中文（`zh-CN`）、日语（`ja-JP`）、韩语（`ko-KR`）和西班牙语（`es-ES`），资源集中在 `src/i18n`。调用时可切换语言、自定义文案以及语义化主题色：

```ts
await window.electronSnapora.capture({
  locale: 'zh-CN',
  showCopyFeedback: true,
  messages: {
    confirm: '复制到聊天框',
    copied: '截图已复制',
    copy: '复制',
    save: '保存',
    close: '关闭',
  },
  theme: {
    mode: 'light',
    accentColor: '#6750a4',
    accentForegroundColor: '#ffffff',
    toolbarBackground: 'rgb(250 250 250 / 96%)',
    toolbarForeground: '#1d1b20',
    tooltipBackground: '#27272a',
    warningColor: '#f59e0b',
    copyFeedbackBackground: '#ffffff',
    copyFeedbackForeground: '#111111',
    copyFeedbackBorderColor: '#dff3eb',
    copyFeedbackIconColor: '#20b88a',
    copyFeedbackIconBackground: '#e4f8ef',
  },
});
```

### 宿主策略注入

如果应用需要接入自定义截图源、特殊存储策略或覆盖层管理，可直接传入自定义适配器：

```ts
const snapora = setupElectronSnapora({
  ipcMain,
  managerOptions: {
    captureAdapter: myCaptureAdapter,
    outputAdapter: myOutputAdapter,
    createOverlay: (display) => myOverlayFactory.create(display),
    overlayReadyTimeoutMs: 15_000,
  },
});
```

### 资源上限限制

可针对不同宿主应用调低安全防护阈值：

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

## 构建与打包配置

请将 `electron-snapora` 放在应用生产依赖 `dependencies` 中，并在构建主进程时将其排除在 bundle 外（externalize）。

### electron-vite 配置示例

```ts
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [/^electron-snapora(?:\/.*)?$/],
      },
    },
  },
});
```

### Webpack 配置示例

```js
module.exports = {
  target: 'electron-main',
  externals: {
    'electron-snapora/main': 'commonjs electron-snapora/main',
  },
};
```

### electron-builder 配置

`electron-builder` 可将本依赖打包至 ASAR 内部，HTML/CSS/JS 资源无需配置 `asarUnpack`。

### Electron Forge 配置

使用 Electron Forge 时保持依赖在 `dependencies` 中，并在 Vite / Webpack 主进程配置中添加上述 external 规则。若配合 pnpm，建议开启 hoisted 扁平依赖结构。

## 支持基线与平台特性

| 操作系统环境                                     | 状态                               |
| ------------------------------------------------ | ---------------------------------- |
| Windows 11 x64, Electron 42.8/43.3               | 已通过全量自动化与手动验证         |
| Windows ARM64                                    | 等待硬件实测                       |
| macOS (Retina 屏与签名应用)                      | 代码与单测已就绪，等待正式签名验证 |
| Linux X11 / XWayland / native Wayland / PipeWire | 处于适配中                         |

### macOS 权限配置

macOS 10.15 及以上需要屏幕录制权限。在应用首次发起截图请求时系统会弹出原生权限授权弹窗。若用户此前拒绝过，Snapora 会自动引导跳转至“系统设置 → 隐私与安全性 → 屏幕录制”并返回 `PERMISSION_DENIED`。

在打包配置（如 electron-builder）中添加权限用途说明：

```json
{
  "build": {
    "mac": {
      "hardenedRuntime": true,
      "extendInfo": {
        "NSScreenCaptureUsageDescription": "用于捕获选定的屏幕区域并进行标注分享。"
      }
    }
  }
}
```

### macOS 快捷键与宿主窗口保护

唤起截图的全局快捷键由宿主注册；进入截图层后，Escape、R（矩形）、T（文字）等按键由 Snapora 处理。在 macOS 上，Snapora 显示截图层时会恢复窗口的可聚焦属性，并请求应用、窗口和页面获得焦点。宿主无需重复调用这些聚焦操作，也无需将 Escape/R/T 注册为全局快捷键。

**宿主窗口保护不是必需配置。** 如果宿主已有焦点管理或防止后台窗口前置的逻辑，应遵守以下接入约定：

- 只操作宿主自己管理的窗口，使用明确的窗口引用或由宿主维护的窗口集合。不要对 `BrowserWindow.getAllWindows()` 返回的全部窗口执行 `setFocusable(false)`：其中也包含 Snapora 窗口，包括后续截图会复用的隐藏 Overlay。截图层、贴图和复制提示窗口都应排除。
- 宿主专属的 macOS 保护逻辑应放在 `process.platform === 'darwin'` 分支内，保持 Windows 行为不变。用 `app.isActive()` 判断应用是否处于前台；设置、会议等窗口聚焦时，不能因为主窗口未聚焦就把整个宿主判为后台。
- 修改窗口状态前检查 `manager.activeJobId`。如果在 `capture()` 外层增加异步焦点恢复，还应对整个“截图与恢复”过程防止重复触发。
- 记录窗口原始状态，在 `finally` 中恢复本次修改，包括取消和失败路径。只恢复仍存活且被本次操作修改过的窗口，避免上一轮截图的延迟回调改变下一轮截图状态。

Snapora 不会在截图结束时调用 `app.hide()`，因为它会隐藏宿主、贴图等所有应用窗口。只有截图前已聚焦的宿主窗口才会恢复聚焦。是否返回之前活跃的外部应用，由宿主决定；Snapora 不提供自动恢复外部应用的能力。不要将 `app.hide()` 作为通用的截图清理步骤。

如果截图层可见但按键无响应，应检查 `app.isActive()`、截图窗口的 `isFocusable()` 与 `isFocused()`、`webContents.isFocused()`，以及 `before-input-event` 是否到达截图层。画面可见不代表已经获得键盘焦点；未到达该 WebContents 的按键也不会触发 `before-input-event`。如果第一次正常、第二次失效，优先检查宿主是否禁止了复用 Overlay 的聚焦。应在真实 Mac 上、其他应用处于前台时验证首次与连续截图，不能仅凭调用了聚焦 API 就认定键盘输入已恢复。

### 并发控制与队列机制

默认情况下，多个截图请求同时发起时会立即返回 `CAPTURE_BUSY`。多窗口复杂应用可开启排队模式：

```ts
const snapora = setupElectronSnapora({
  ipcMain,
  managerOptions: {
    busyPolicy: 'queue',
    maxQueuedCaptures: 4,
  },
});
```

### 主进程结构化诊断钩子

可通过诊断回调将截图生命周期日志与性能耗时接入应用自身的日志系统：

```ts
const snapora = setupElectronSnapora({
  ipcMain,
  managerOptions: {
    onDiagnostic(event) {
      logger.debug('electron-snapora', event);
    },
  },
});
```

### 错误码速查表

| 错误代码                  | 说明                                         |
| :------------------------ | :------------------------------------------- |
| `CAPTURE_BUSY`            | 截图通道忙碌、同一发起方互斥或排队容量已满。 |
| `INVALID_REQUEST`         | 来源校验不通过、传入参数非法或请求格式错误。 |
| `RESOURCE_LIMIT_EXCEEDED` | 图像像素尺寸或二进制大小超出安全阈值。       |
| `PERMISSION_DENIED`       | 操作系统屏幕录制权限被拒绝。                 |
| `DISPLAY_NOT_FOUND`       | 未找到匹配的目标显示器或捕获源。             |
| `CAPTURE_FAILED`          | 屏幕捕获底层未能成功生成画面帧。             |
| `OVERLAY_LOAD_FAILED`     | 覆盖层静态资源缺失或渲染进程启动超时。       |
| `EXPORT_FAILED`           | 剪贴板写入、文件保存对话框或 PNG 编码失败。  |
| `INVALID_RESULT`          | 覆盖层返回了非法数据或未预期的生命周期消息。 |
| `UNSUPPORTED_PLATFORM`    | 当前操作系统或显示协议不受支持。             |

## 开源协议与商标

源代码遵循 [MIT 许可证](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)。`electron-snapora` 名称与官方品牌受 [商标政策](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md) 保护。
