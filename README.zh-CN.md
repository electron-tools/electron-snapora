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

## 升级到 1.0.26：宿主需要配置什么

旧的冻结画面单屏截图没有新增必填参数。多屏实时选择和吸附需要宿主显式启用，仅升级 npm 包不会自动开启。

| 目标 | 宿主配置 |
| --- | --- |
| 多屏实时选择 | 每次 `capture({ interactionMode: 'live', display: 'all' })`；支持 Windows 10 2004+ / macOS 14+。不支持的平台继续使用 `frozen` + `cursor`。 |
| 自动吸附 | 主进程创建对应平台的 `createWindowsSnapProvider(...)` / `createMacSnapProvider(...)`，传入 `setupElectronSnapora({ ipcMain, managerOptions: { getWindowSnapRegions: provider } })`；直接使用 `ScreenshotManager` 时传 `{ getWindowSnapRegions: provider }`。不传 provider 仍可自由框选，但不会自动吸附。 |
| 只吸附整个窗口 | 创建 provider 时显式传 `{ granularity: 'window' }`。省略时 API 默认是 `panel`，可能选中窗口内部区域；`fine` 更细。 |
| macOS 权限 | 宿主调用 `macProvider.getPermissions()` 查询，在用户点击授权后调用 `getPermissions(true)`，再查询并决定是否开始截图。live 采集需要屏幕录制权限，AX 容器识别需要辅助功能权限。若产品要求两项都授权才能截图，应由宿主拦截；库不会自动强制这个策略或提供权限界面。 |
| 正式应用打包 | 将 `node_modules/electron-snapora/dist/native/**` 解包到 ASAR 外，并处理宿主签名。标准 npm 布局无需传 helper 路径；自定义 `extraResources` 路径按后文配置。 |

provider 只在主进程创建一次并复用，退出时调用 `dispose()`；`prepare()` 是可选预热。无需传 demo 对象、DOM、窗口列表或权限布尔值。完整主进程、preload、权限桥及签名示例见后文“多屏实时选择、容器吸附与宿主权限接入”。

## 功能特性

- Windows 10 2004+ / macOS 14+ 多屏实时选择：移动鼠标跨屏选择，确定选区后再采集画面。
- 跨应用窗口与容器吸附：Windows UI Automation、macOS AX，支持 `window / panel / fine` 三档粒度。
- 面向宿主的 macOS 权限查询、显式授权请求和结构化截图失败结果。
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

HTML/CSS/JS 资源可以保留在 ASAR 内，Mac 可执行 helper 必须解包；配置见下文[正式应用如何携带 Mac helper](#正式应用如何携带-mac-helper)。

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

frozen 模式检查 Electron 宿主权限；live 采集与 AX 嗅探检查原生 helper 权限。屏幕录制和辅助功能未授权时的行为不同，查询、显式授权、IPC 和分发方式见下文[宿主权限说明](#权限由谁检查谁告知用户)。不要假定截图会自动申请两项权限。

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

## 多屏实时选择、容器吸附与宿主权限接入

这些能力属于 npm 包公开 API，不是 demo 专属功能。`demo/` 只是源码仓库的测试应用，不随 npm 发布。默认接入仍是冻结画面的单屏截图；安装依赖不会自动注册吸附 provider，也不会自动带上权限界面。

`interactionMode: 'live'` 支持跨屏移动鼠标、悬停吸附、单击选区和自由拖框；一次拖动限制在起始显示器内。选区确定后才采集该屏幕并进入原有标注编辑器。`display: 'all'` 只能配合 live 使用，不表示将多个屏幕拼成一张图片。旧模式使用 `interactionMode: 'frozen', display: 'cursor'`。

| 粒度            | 行为                                       |
| --------------- | ------------------------------------------ |
| `window`        | 只吸附完整应用窗口，不遍历可访问性树。     |
| `panel`（provider API 默认） | 主要布局面板和侧栏，过滤小控件及嵌套卡片。 |
| `fine`          | 更细的可访问性容器，如卡片、列表项。       |

Windows 使用 UI Automation；macOS 使用 CoreGraphics 窗口边界、AX 容器与 ScreenCaptureKit 像素采集。两端 provider 均支持 `prepare()`、`dispose()`，先增量返回窗口，再补充容器。Mac 在命中与遮挡筛选前排除系统合成/状态层，保留真实全屏应用。识别精度取决于目标应用暴露的可访问性树，Canvas/自绘界面可能只有整窗。实时模式要求 Windows build 19041+ 或 macOS 14+；Linux 暂不支持实时模式。

### 宿主主进程

在 `app.whenReady()` 完成后，先使用下文自行构建的 preload 创建宿主窗口，再于加载页面前调用 `setupHostScreenshot(hostWindow, trustedUrl)`，传入可信页面完整的 `file://` URL 或开发 URL，保证渲染层初始化前已注册 IPC。它替代前文的 `setupElectronSnapora()` 初始化，不要重复注册相同通道。保存返回的清理函数，在窗口关闭/应用退出时调用。多宿主窗口应共享一个 manager/provider，并校验各个获准窗口的页面来源。

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

### 宿主 Preload 与渲染层

将以下 preload 打包成单个 CommonJS 文件，把产物绝对路径传入 `BrowserWindow.webPreferences.preload`，保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。preload 中的 `electron-snapora/preload` 要内联打包，仅将 `electron` 保持 external；沙箱 preload 不能在运行时加载任意 npm 模块。主进程的包入口则保持 external。参见 [Electron 沙箱说明](https://www.electronjs.org/docs/latest/tutorial/sandbox)。

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
contextBridge.exposeInMainWorld('snaporaPermissions', {
  get: () => ipcRenderer.invoke('host:snapora-permissions', false),
  request: () => ipcRenderer.invoke('host:snapora-permissions', true),
});
```

示例中的 `host:snapora-permissions` 和 `window.snaporaPermissions` 是宿主自己定义的桥，不是库内置导出；渲染层需补相应类型声明。`get()` 返回 `{ liveSupported, macPermissions: null | { screenRecording, accessibility } }`，`null` 表示示例未创建受支持的 Mac provider。权限查询异常会使 IPC reject，应与“用户未授权”分开提示。

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

### 权限由谁检查、谁告知用户

| 权限或异常            | 库的反馈                                                                                 | 宿主应处理                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 缺少屏幕录制权限      | live 截图返回 `status: 'failed', code: 'PERMISSION_DENIED'`，已有截图 IPC 原样返回结果。 | 显示用途说明，提供授权/设置入口。                                                     |
| 缺少辅助功能权限      | 容器吸附退化为整窗/自由框选；截图成功不代表 AX 已授权。                                  | 查询 `getPermissions()`，或监听 provider 的 `onDiagnostic` → `accessibility: false`。 |
| helper 缺失或无法启动 | 权限查询 reject，截图可能返回 `CAPTURE_FAILED`，不是 `PERMISSION_DENIED`。               | 先修复打包、路径或签名，不要当作用户拒绝。                                            |

`await macProvider.getPermissions()` 查询实际 helper 的两项权限，不弹窗。用户点击授权按钮后，调用 `await window.snaporaPermissions.request()`；桥转到 `getPermissions(true)` 请求屏幕录制与辅助功能授权。它是发起请求，不会一直等待用户操作系统设置；之后需再次查询，必要时重启签名后的应用。布尔值 `false` 不区分尚未请求、拒绝或系统限制。不要在截图进行中请求权限。

库没有自动权限变更推送，也没有内置权限渲染层桥。宿主负责提示界面、IPC 来源校验、清理与状态刷新。live 采集以原生后端权限主体为准，不能只检查 Electron 宿主状态；frozen 模式保留 Electron 权限检查，已拒绝时打开屏幕录制设置。标准截图/嗅探不需要麦克风、摄像头、输入监控、完全磁盘访问或自动化权限。demo 中可选的 AppleScript 焦点恢复兜底可能请求自动化权限，不应把它当作包接入依赖。

### 正式应用如何携带 Mac helper

将 `electron-snapora` 放在生产 `dependencies`，主进程入口保持 external。发布包必须携带 **arm64 + x86_64 universal** 可执行文件 `dist/native/snapora-macos`。运行时宿主不需要 Swift、Xcode、`koffi` 或 demo 文件。原生 helper 是独立进程，不是 Node 原生 addon。

使用仓库当前的 **electron-builder 26** 时，将 helper 解包：

```json
{
  "build": {
    "asarUnpack": ["node_modules/electron-snapora/dist/native/**"]
  }
}
```

Windows 随包提供两个预编译程序：`dist/native/snapora-windows-snap.exe`（UI Automation）和 `dist/native/snapora-windows-capture.exe`（像素采集）。Electron 直接启动它们，运行时不调用 PowerShell、不编译 C#、不下载或生成临时可执行文件。它们使用 Windows 的 .NET Framework 运行时，不要求用户安装编译器或 SDK；属于 AnyCPU 托管程序，并非自包含 .NET 包。两个 exe 均须按上例解包到 ASAR 外；HTML/CSS/JS 可留在 ASAR 内。

Windows 源码开发执行 `pnpm run build`（包括 `pnpm demo`）会先编译辅助程序。可用 `pnpm run build:native:windows` 单独编译、`pnpm run verify:native:windows` 校验构建产物和源码哈希。npm 使用者不需要构建工具；接入 API、预热复用、取消、三档吸附和截图编辑功能保持一致。

在 macOS/Linux 制作跨平台发布包前，先在相同源码版本的 Windows 上构建，将 `snapora-windows-snap.exe`、`snapora-windows-capture.exe`、`windows-helpers.json` 一并复制到发布机器的 `src/electron/native`。CI 提供 `windows-native-helpers` 产物。`release:check` 同时要求 Windows 两个 exe 和 Mac universal helper，并拒绝 Windows 文件缺失、损坏或源码过期。Windows 可执行文件的生产签名可在宿主打包阶段应用到解包后的 helper。

默认查找路径会将 `app.asar` 转为 `app.asar.unpacked`。保留可执行权限，并把 helper 纳入宿主的 Developer ID 签名、公证流程；源码构建的 ad-hoc 签名仅供开发，不等于生产签名。[electron-builder 26 文档](https://www.electron.build/v26/docs/mac/) 的 `mac.binaries` 可指定额外需要签名的可执行文件。builder 27 使用 `asar.unpack` 与对应 `mac.sign` 配置；Forge 同样需要解包并签名该文件。

若改为 `extraResources`，须将**同一个绝对路径**同时传给 `createMacSnapProvider({ executablePath })` 与 `new ElectronCaptureAdapter({ macHelperPath })`，并通过 `managerOptions.captureAdapter` 注入适配器。除 manager/provider 外，注入的 adapter 也由宿主自行 `dispose()`。权限验收应使用最终签名后的应用身份，而不只是在终端启动的 Electron。

### 源码 demo、发布与验证

仓库开发运行 `pnpm demo`（`pnpm run demo:mac` 为别名）；macOS 14+ 会先自动编译 helper，仅构建机器需要 Xcode Command Line Tools。demo 默认 live + window，按独立窗口边界吸附；仍可切换 panel / fine 对比内部容器效果。包本身不引用 demo 的权限 IPC 或焦点恢复代码。

发布前在 Mac 执行：

```bash
pnpm run test:native:mac
pnpm run build:native:mac:universal
pnpm run release:check
```

`release:check` 会拒绝缺失、单架构或结构损坏的 Mac helper；在 macOS 上还检查执行权限和签名。构建只把预编译 helper 复制到 `dist/native`，不发布 C#/PowerShell/Swift 源码。CI 先构建 Windows 产物供跨平台检查使用，再在 Mac 编译/运行 Swift 回归、检查 universal 产物，并验证安装后的 ESM/CommonJS 消费项目；包验证从真实 tgz 安装，不依赖仓库 self-reference。

用户已反馈系统窗口过滤后 Mac demo 截图与吸附可用。签名应用分发、双架构真机、完整 Lark/浏览器/Ping 矩阵仍需发版验收，不把模拟测试当作实机通过。详见 [实现与验收记录](https://github.com/electron-tools/electron-snapora/blob/main/docs/macos-container-snap.md)。

## 开源协议与商标

源代码遵循 [MIT 许可证](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE)。`electron-snapora` 名称与官方品牌受 [商标政策](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md) 保护。
