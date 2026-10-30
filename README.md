# electron-snapora — Electron screenshot plugin with annotations

[![version](https://img.shields.io/npm/v/electron-snapora?style=flat-square&color=cb3837)](https://www.npmjs.com/package/electron-snapora)
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

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

An easy-to-integrate Electron screenshot plugin with one-call setup and secure Preload IPC for region capture, annotation editing, clipboard copy, PNG export, and pin-to-screen windows.

<p align="center">
  <img src="./docs/assets/preview.jpg" alt="electron-snapora preview" width="800" />
</p>

## Upgrading to 1.0.26: host configuration

Existing frozen, single-display captures have no new required arguments. Upgrading the package alone does not enable live selection or snapping.

| Goal | Host configuration |
| --- | --- |
| Live selection across displays | Call `capture({ interactionMode: 'live', display: 'all' })` on Windows 10 2004+ / macOS 14+. Keep `frozen` + `cursor` on unsupported platforms. |
| Automatic snapping | Create `createWindowsSnapProvider(...)` / `createMacSnapProvider(...)` in the main process and pass it to `setupElectronSnapora({ ipcMain, managerOptions: { getWindowSnapRegions: provider } })`. With `ScreenshotManager`, pass `{ getWindowSnapRegions: provider }` directly. Without a provider, manual selection works but automatic snapping is disabled. |
| Whole-window snapping only | Explicitly create the provider with `{ granularity: 'window' }`. The API default is `panel`, which can select part of a window; `fine` selects smaller regions. |
| macOS permissions | Query `macProvider.getPermissions()`, call `getPermissions(true)` after a user authorization action, then query again before deciding to capture. Live capture needs screen recording; AX containers need accessibility. Hosts that require both before any capture must enforce that policy themselves; the library supplies neither that restriction nor permission UI. |
| Packaged applications | Unpack `node_modules/electron-snapora/dist/native/**` from ASAR and apply host signing. Standard npm layouts need no helper path argument; see the custom `extraResources` instructions below for relocated helpers. |

Create and reuse the provider in the main process, and call `dispose()` on shutdown. `prepare()` is optional prewarming. Do not pass demo objects, DOM nodes, window lists, or permission booleans. Complete main-process, preload, permission-bridge, and signing examples follow under “Live selection, container snapping, and host permissions”.

## Features

- Live selection across displays on Windows 10 2004+ and macOS 14+, with capture after selection.
- Cross-application window/container snapping via UI Automation (Windows) and AX (macOS), with `window`, `panel`, and `fine` granularity.
- Host-accessible macOS permission queries, explicit authorization requests, and structured capture failures.
- Electron screenshot and screen capture.
- Region capture with an interactive snipping overlay.
- Contextual presets for rectangle, ellipse, arrow, brush, text, adjustable mosaic, and tiled watermark annotations.
- Directly drag existing annotations without leaving the active drawing tool.
- Clipboard copy, native PNG save, and pin-to-screen windows.
- Proportionally resizable pinned windows that remain at the highest always-on-top level until closed.
- TypeScript, ESM, and CommonJS support.

Repository: [github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)

Support: [GitHub Issues](https://github.com/electron-tools/electron-snapora/issues) · [@novratools on X](https://x.com/novratools)

Trademark policy: [TRADEMARKS.md](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md)

## Support and bug reports

If something is unclear or does not work as expected, first search the [existing issues](https://github.com/electron-tools/electron-snapora/issues). If no issue matches, open a [new GitHub Issue](https://github.com/electron-tools/electron-snapora/issues/new) or contact [@novratools on X](https://x.com/novratools).

A useful bug report should include:

- the `electron-snapora`, Electron, Node.js, and operating system versions;
- minimal reproduction steps and the smallest reproducible project when possible;
- expected behavior and actual behavior;
- relevant error messages, logs, screenshots, or recordings with secrets and private data removed.

For security or privacy-sensitive problems, do not post credentials, private screenshots, tokens, or confidential logs in a public issue. Contact the project through X first and share sensitive details only through an agreed private channel.

## Quick start

**Minimum Electron version:** Electron 42. Node.js 20 or newer is also required.

### 1. Install

```bash
npm install electron-snapora
```

This package expects the host application to provide Electron. If Electron is not installed yet:

```bash
npm install --save-dev electron
```

Keep the package in the application's production `dependencies`. It contains the screenshot UI and
Preload files needed by the packaged application.

### 2. Set up the main process

`setupElectronSnapora()` creates the screenshot manager, registers IPC, and gives the window a
ready-to-use Preload path:

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

That is the complete default integration. Keep `electron-snapora` external when bundling the Electron
main process so its packaged HTML, CSS, and Preload files remain beside the library entry point. See
[Bundling and packaging](#bundling-and-packaging) for electron-vite, Webpack, electron-builder, and
Forge examples.

### 3. Capture from the renderer

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  // PNG bytes for upload, preview, or other host application logic.
  console.log(result.data, result.bounds, result.output);
}
```

The screenshot overlay lets the user select a region, draw rectangles, ellipses, arrows, brush
strokes, text, adjustable mosaic, or a tiled watermark, then copy, save, or pin the final PNG. While
a drawing tool is active, dragging the topmost existing annotation moves it without switching tools;
dragging an empty area keeps drawing with the current tool. `Escape` cancels. The result is always one
of `completed`, `cancelled`, or `failed`, so callers do not need exception-based control flow for
normal user actions.

The vertical pin button creates a frameless window at the selected screen position. Each pinned
screenshot stays at the highest standard always-on-top level until closed, can be dragged
independently, and resizes proportionally with a menu-safe 176 px minimum width and height. The
circular close control appears only while hovering the pinned window. Right-click to copy, save, or
close it; a successful copy shows a localized in-window confirmation.

Cancel an active task from the same renderer with:

```ts
await window.electronSnapora.cancel();
```

For TypeScript, declare the injected renderer API once in the host application:

```ts
import type { ScreenshotRendererApi } from 'electron-snapora/types';

declare global {
  interface Window {
    electronSnapora: ScreenshotRendererApi;
  }
}
```

## Applications with an existing Preload

Keep the main-process setup, ignore `snapora.preloadPath`, and expose the API from the application's
own bundled Preload:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

Sandboxed Preload scripts cannot load arbitrary npm modules at runtime, so an existing host Preload
must be bundled. Applications without an existing Preload should use the package-provided path from
the quick start and need no extra Preload configuration.

## Custom page origins

For safety, screenshot IPC accepts only top-level pages loaded with `BrowserWindow.loadFile()` by
default and always rejects iframe calls. If the host uses a custom protocol or local development
server, allow only the exact trusted origins:

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

Snapora still enforces the top-level-frame rule. It also parses capture options again in the main
process and returns `INVALID_REQUEST` before screen capture for unknown or invalid values.

## Package entry points

Most applications need only `electron-snapora/main` and the injected `window.electronSnapora` API.
The other entry points support custom Preloads and advanced integrations:

```ts
import { setupElectronSnapora } from 'electron-snapora/main';
import { exposeScreenshotApi } from 'electron-snapora/preload';
import { normalizeRect } from 'electron-snapora/core';
```

The default package has no native addon and no post-install compilation.

## Advanced configuration

Pass manager settings through `setupElectronSnapora()` so the simple integration shape stays the
same as requirements grow.

The post-capture clipboard confirmation is disabled by default. Enable it per capture when the
host wants the standalone copy feedback window. It appears for 3 seconds with a white background,
black text, a pale green border, and a green checkmark in both light and dark modes. Customize its
text with `messages.copied` and its colors with the `copyFeedback*` theme fields below:

```ts
await window.electronSnapora.capture({
  display: 'cursor',
  showCopyFeedback: true,
});
```

### Theme and localization

The overlay defaults to English (`en-US`) and a dark toolbar. Built-in languages are English (`en-US`),
Simplified Chinese (`zh-CN`), Japanese (`ja-JP`), Korean (`ko-KR`), and Spanish (`es-ES`).
Language resources live in `src/i18n`. A capture can select a locale, override individual messages,
and provide semantic theme colors:

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

Message resolution is deterministic: English baseline, selected built-in locale, then host
overrides. This means a partial `messages` object always falls back to a complete accessible
label set. Unknown message or theme keys, empty messages, and unsupported modes are rejected at
the main-process IPC boundary.

Pinned screenshots resolve their menu labels from the same `locale` and `messages` passed to the
capture that created them. After a host language switch, pass the new locale to the next
`capture()` call; newly pinned screenshots use it immediately. Existing pinned windows keep the
language captured at creation because they are independent desktop windows and there is no global
host-language subscription.

Theme styling uses three layers: internal base colors, public semantic colors, and private
component aliases. `ScreenshotTheme` only changes semantic values, so applications do not depend
on overlay DOM or CSS class names. In addition to the example above it supports mask, toolbar
border/hover, tooltip foreground, destructive/warning actions, warning foreground, and
selection-handle colors.

### Host policy injection

Applications with a custom capture source, storage policy, or overlay host can pass those
dependencies without changing the setup flow:

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

`captureAdapter`, `outputAdapter`, `createOverlay`, `overlayOptions`, and `ipcMain` are high-level
injection points. `runner` remains available only for applications that need to replace the entire
session lifecycle; when it is supplied, the other default-runner options are ignored.

Custom capture adapters may implement the optional synchronous
`resolveTargetDisplay(options)` method. When present, Snapora loads the still-hidden Overlay in
parallel with `capture()`, keeps the resolved display locked through initialization, and reveals the
window only after the Renderer has prepared the frame. The resolved display must match the first
frame returned by the following `capture()` call. Adapters that omit this method keep the compatible
capture-then-load sequence.

Existing custom adapters can keep returning `{ display, dataUrl, pixelSize }` without a `kind`
field. On Windows, the built-in adapter instead sends an internal desktop source reference so the
Overlay can draw the first MediaStream frame directly to Canvas. Source references are prepared and
cached outside the click path, and the actual video size becomes the Canvas pixel size. If direct
capture fails, Snapora retries once with the legacy image frame and uses that stable path for later
captures on the same display. macOS live capture uses the native helper to return image frames. Linux continues to use image frames until its native
capture paths are validated.

Resource limits can be lowered per host application:

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

Defaults allow 64 Mi pixels, a 192 MiB capture Data URL, and a 64 MiB PNG result. Absolute hard
ceilings are 128 Mi pixels / 256 MiB / 256 MiB. Invalid configuration fails during manager
construction; oversized capture adapters and Overlay output are rejected with
`RESOURCE_LIMIT_EXCEEDED` or `INVALID_REQUEST` before clipboard or disk processing.

## Bundling and packaging

Keep `electron-snapora` in the application's production `dependencies` and externalize it from the
Electron main-process bundle. Its main entry locates sibling Overlay HTML, CSS, and Preload files
inside the installed package; inlining that entry changes `__dirname` and breaks the resource
relationship.

electron-vite 5 externalizes production dependencies by default. An explicit rule is useful when
the application overrides dependency handling:

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

Webpack applications should configure the main-process build similarly:

```js
module.exports = {
  target: 'electron-main',
  externals: {
    'electron-snapora/main': 'commonjs electron-snapora/main',
  },
};
```

JavaScript, HTML and CSS can remain inside ASAR. The Mac executable must be unpacked; see [Shipping the native Mac helper](#shipping-the-native-mac-helper). If a bundler inlines the package or packaging excludes part
of `dist`, resource resolution throws an `[electron-snapora] Packaged resource missing` error with
the expected path instead of waiting on a blank Overlay.

For Electron Forge, keep the package in `dependencies`; add the same external rule to the Forge
Vite or Webpack main-process config. Forge projects that use pnpm should use a hoisted
`node_modules` layout because Forge discovers production dependencies from the physical dependency
tree.

### Published package contents

The npm package contains only the compiled ESM/CommonJS entry points, TypeScript declarations,
Preloads, Overlay HTML/CSS/JavaScript, precompiled native helpers, package metadata, the five READMEs, changelog, and license. C#/PowerShell/Swift source, tests, demos, repository documentation, CI configuration, and release scripts are not published.

## Support baseline

The minimum supported version is Electron 42. The package is built for a Node.js 20 baseline and has
passed the real capture/Overlay lifecycle on Windows 11 x64 with Electron 42.8.0 and 43.3.0.

| Environment                                      | Status                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| Windows 11 x64, Electron 42.8/43.3               | Automated and manually exercised                        |
| Windows ARM64                                    | Pending hardware validation                             |
| macOS, Retina and signed app                     | Code/tests complete; signed hardware validation pending |
| Linux X11 / XWayland / native Wayland / PipeWire | Not yet declared supported                              |

New Electron majors remain subject to the capture, Overlay, preload, and packaging matrix. Native
Wayland is especially not assumed equivalent to X11 because Electron documents limitations in its
Screen API.

### macOS permission

Frozen capture uses Electron permission checks; live capture and AX discovery use the native helper. Screen Recording and Accessibility have different failure/degradation behavior. See [host permission responsibilities](#permission-responsibilities) below for queries, explicit prompting, IPC and packaging. Do not assume capture automatically requests both permissions.

### macOS shortcuts and host window protection

The host registers the global shortcut that starts a capture. Inside the capture overlay, Snapora handles keys such as Escape, R (rectangle), and T (text). On macOS, Snapora restores the overlay's focusability and requests application, window, and web-content focus when showing it. The host does not need to duplicate these focus calls or register Escape/R/T as global shortcuts.

**Window protection is optional.** If your host already manages focus or prevents background windows from coming forward, follow these integration rules:

- Operate only on windows owned by your host, using explicit window references or a collection maintained by the host. Do not apply `setFocusable(false)` to every window returned by `BrowserWindow.getAllWindows()`: that list also contains Snapora windows, including hidden overlays reused by later captures. Exclude overlays, pinned images, and copy feedback windows.
- Keep host-specific macOS protection inside a `process.platform === 'darwin'` branch so Windows behavior stays unchanged. Check application activity with `app.isActive()`; a focused settings or meeting window also means the host is active, even if its main window is not focused.
- Before changing window state, check `manager.activeJobId`. If you add asynchronous focus restoration around `capture()`, also guard the entire capture-and-restore operation against duplicate triggers.
- Record the original window state and restore any changes in `finally`, including cancellation and failure paths. Restore only surviving windows that your operation changed. Avoid delayed callbacks from one capture changing the state of the next capture.

Snapora does not call `app.hide()` when a capture ends: that would hide every application window, including the host and pinned images. It restores focus to the host window only if that window was focused before capture. Returning focus to a previously active external application is a host policy; Snapora does not provide automatic external-application restoration. Do not use `app.hide()` as a general cleanup step.

If the overlay is visible but keys do not respond, inspect `app.isActive()`, the overlay's `isFocusable()` and `isFocused()`, `webContents.isFocused()`, and whether `before-input-event` reaches the overlay. A visible overlay does not prove keyboard focus, and `before-input-event` cannot receive keys that never reached that WebContents. If the first capture works but the second fails, check whether host protection disabled the reused overlay. Validate both first and repeated captures on a real Mac while another application is foreground; focus API calls alone do not prove successful keyboard delivery.

### Freeform selection

Window snapping and attach behavior are intentionally disabled. The screenshot Overlay always uses
freeform drag selection so the same interaction remains predictable across host applications and
desktop platforms.

### Lifecycle and concurrency

A `ScreenshotManager` always runs one global Overlay task at a time. Its default `reject` policy
keeps existing behavior: a second call immediately resolves with `CAPTURE_BUSY`. Applications with
multiple host windows can opt into a bounded FIFO queue:

```ts
const snapora = setupElectronSnapora({
  ipcMain,
  managerOptions: {
    busyPolicy: 'queue',
    maxQueuedCaptures: 4,
  },
});
```

Only different host renderers are queued. A renderer cannot create a second active or queued task,
so repeated button clicks still return `CAPTURE_BUSY`; a full queue does the same. Cancelling a
renderer task or destroying that `WebContents` removes its queued request before an Overlay can be
opened. `queuedCaptureCount` exposes the current queue length for diagnostics.

Use one setup for one application-wide screenshot lane, or separate managers only when the
application intentionally supports independent capture lanes. `snapora.manager.queuedCaptureCount`
exposes the queue length, and `snapora.unregister()` cleans up IPC during shutdown or main-process
hot reload. Active-task completion, cancellation, and failure all advance the queue and release
Overlay listeners and windows.

### Main-process diagnostics

Use the optional structured hook to feed application logs or performance telemetry:

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

Events cover queue wait, complete session, capture, Overlay creation/loading/readiness, frame
preparation, and output. Start events carry a timestamp; completion, cancellation, and error events
also carry `durationMs`. Failures include the public error code and message. A missing packaged
Overlay resource additionally reports its label and resolved path in `context.missingResources`.

The hook runs only in the main process and accepts serializable scalar/array context values; no
`BrowserWindow`, `WebContents`, `NativeImage`, IPC event, or captured PNG is exposed. Exceptions
thrown by the application's logger are isolated and never change the screenshot result.

### Error results

| Code                      | Meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `CAPTURE_BUSY`            | The lane, sender mutex, or configured queue capacity is busy.    |
| `INVALID_REQUEST`         | Host/Overlay IPC origin, options, or payload failed validation.  |
| `RESOURCE_LIMIT_EXCEEDED` | Capture or PNG data exceeded a configured limit.                 |
| `PERMISSION_DENIED`       | The OS denied screen capture permission.                         |
| `DISPLAY_NOT_FOUND`       | The requested display or matching capture source is unavailable. |
| `CAPTURE_FAILED`          | Electron could not produce a usable captured frame.              |
| `OVERLAY_LOAD_FAILED`     | Packaged resources, Renderer startup, or preparation failed.     |
| `EXPORT_FAILED`           | Clipboard, save dialog, PNG encoding, or file output failed.     |
| `INVALID_RESULT`          | The Overlay returned an invalid result or lifecycle message.     |
| `UNSUPPORTED_PLATFORM`    | The current OS/display protocol is explicitly unsupported.       |

## Live selection, container snapping, and host permissions

These are package APIs, not demo-only features. `demo/` is a source-repository test application and is not shipped in npm. The default integration remains frozen single-display capture; installing the package does not automatically enable a snap provider or permission UI.

`interactionMode: 'live'` supports moving the pointer between displays, hovering to snap, clicking to select, and dragging a free rectangle. A drag stays on its starting display; capture starts after selection, then the existing annotation editor opens. `display: 'all'` requires live mode and does not produce a stitched multi-display image. Use `interactionMode: 'frozen', display: 'cursor'` for the earlier mode.

| Granularity       | Behavior                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| `window`          | Whole application windows; no accessibility-tree traversal.             |
| `panel` (provider API default) | Main layout panels and sidebars; skips small controls and nested cards. |
| `fine`            | Smaller exposed accessibility containers, such as cards and list items. |

Windows uses UI Automation; macOS uses CoreGraphics window bounds, AX containers, and ScreenCaptureKit pixels. Both providers expose `prepare()` and `dispose()` and stream windows before containers. macOS filters system compositor/status surfaces before hit testing and occlusion; ordinary fullscreen applications remain selectable. Results depend on the target application's accessibility tree; canvas/custom UI may provide only a window. Windows requires build 19041+; macOS live mode requires 14+. Linux live mode is unsupported.

### Host main process

After `app.whenReady()`, create your host window with the bundled preload below, then call `setupHostScreenshot(hostWindow, trustedUrl)` before loading the page. Pass the exact trusted `file://` URL or development URL; register IPC before renderer initialization. This replaces the earlier `setupElectronSnapora()` call; do not register the same channels twice. Keep the returned cleanup and call it on window closure/app shutdown. For multiple host windows, share one manager/provider and validate the specific trusted senders.

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

### Host preload and renderer

Bundle this preload into a single CommonJS file and pass its absolute output path to `BrowserWindow.webPreferences.preload`; keep `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. Bundle `electron-snapora/preload` into that file, leaving only `electron` external. A sandboxed preload cannot load arbitrary package modules at runtime. The main-process package must remain external. See [Electron sandbox documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox).

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
contextBridge.exposeInMainWorld('snaporaPermissions', {
  get: () => ipcRenderer.invoke('host:snapora-permissions', false),
  request: () => ipcRenderer.invoke('host:snapora-permissions', true),
});
```

The `host:snapora-permissions` channel and `window.snaporaPermissions` object below are host-owned example APIs, not built-in Snapora exports. Add their types to your renderer declarations. `get()` returns `{ liveSupported, macPermissions: null | { screenRecording, accessibility } }`; `null` means this example has no supported Mac provider. Query errors reject the IPC call and should be displayed separately from permission denial.

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

### Permission responsibilities

| Permission / condition      | Package behavior                                                                                                 | Host responsibility                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Screen Recording missing    | Live capture returns `status: 'failed', code: 'PERMISSION_DENIED'`; the normal capture IPC forwards this result. | Show an explanation and offer authorization/settings.                        |
| Accessibility missing       | Container discovery degrades to window/free selection; screenshot success does not imply AX permission.          | Read `getPermissions()` or provider `onDiagnostic` → `accessibility: false`. |
| Helper missing/unlaunchable | Query rejects; capture may return `CAPTURE_FAILED`, not `PERMISSION_DENIED`.                                     | Fix packaging/path/signing before asking for consent.                        |

`await macProvider.getPermissions()` checks the actual helper without prompting. Call `await window.snaporaPermissions.request()` only from the user's authorization-button handler; it maps to `getPermissions(true)` and requests Screen Recording and Accessibility. This starts the request, not a wait for the user to change settings: query again afterward and restart the signed app if required. Boolean `false` does not distinguish not-yet-requested, denied, or restricted. Do not call permission requests during capture.

The library provides no automatic permission-change push or built-in permission renderer bridge. The host owns its UI, sender validation, IPC cleanup, and refresh. Live capture checks the native backend's permission identity; Electron host permission alone is not authoritative. Frozen capture retains Electron permission checks and opens Screen Recording settings when the status is denied. Standard screenshot/snapping needs no microphone, camera, input-monitoring, full-disk-access, or Automation permission. The demo's optional AppleScript focus-restoration fallback may request Automation; do not copy it as a screenshot dependency.

### Shipping the native Mac helper

Keep `electron-snapora` in production dependencies and externalize its main entry. The released package must contain the universal **arm64 + x86_64** `dist/native/snapora-macos` executable. Runtime hosts do not need Swift, Xcode, `koffi`, or any demo file. Native executables are separate processes, not Node native addons.

For **electron-builder 26** (the repository's version), unpack the helper:

```json
{
  "build": {
    "asarUnpack": ["node_modules/electron-snapora/dist/native/**"]
  }
}
```

Windows ships two precompiled executables: `dist/native/snapora-windows-snap.exe` (UI Automation) and `dist/native/snapora-windows-capture.exe` (pixel capture). Electron launches them directly; there is no runtime PowerShell, C# compilation, download, or temporary executable. Both require the Windows .NET Framework runtime, not a compiler or SDK. They are AnyCPU managed executables, not self-contained .NET bundles. Keep both outside ASAR using the configuration above; HTML/CSS/JS may remain inside.

On Windows, `pnpm run build` (and therefore `pnpm demo`) compiles the helpers before bundling. `pnpm run build:native:windows` builds them separately; `pnpm run verify:native:windows` verifies the bundled binaries and source hashes. The npm consumer needs no build tools. Public APIs, warmup, worker reuse, cancellation, three snapping levels, and screenshot editing are unchanged.

For a cross-platform release built on macOS/Linux, first build on Windows at the same source revision, then copy `snapora-windows-snap.exe`, `snapora-windows-capture.exe`, and `windows-helpers.json` together into `src/electron/native` on the release machine. CI publishes these as `windows-native-helpers`. `release:check` requires both Windows helpers and the universal Mac helper and rejects missing, corrupt, or stale Windows artifacts. Apply Windows executable signing during host packaging to the unpacked helpers as appropriate.

The default lookup maps `app.asar` to `app.asar.unpacked`. Preserve executable permission and include this helper in the host's Developer ID signing/notarization process; the repository's ad-hoc development signature is not production signing. [electron-builder 26 signing](https://www.electron.build/v26/docs/mac/) documents `mac.binaries` for additional executables. For builder 27, use `asar.unpack` and the corresponding `mac.sign` settings. Forge hosts must likewise unpack and sign the executable.

If using `extraResources` instead, set the **same absolute helper path** on both `createMacSnapProvider({ executablePath })` and `new ElectronCaptureAdapter({ macHelperPath })`, then inject that adapter through `managerOptions.captureAdapter`. Dispose the injected adapter yourself in addition to the provider and manager. Validate permission prompts with the final signed app identity, not just terminal-launched Electron.

### Source demo, release, and verification

For repository development, `pnpm demo` (alias `pnpm run demo:mac`) builds the helper automatically on macOS 14+; Xcode Command Line Tools are needed only on the build machine. The demo defaults to live mode and window granularity (whole windows); its selector still offers panel and fine modes for comparison. None of its permission IPC or focus-restoration code is imported by the package.

Before publishing, run on a Mac:

```bash
pnpm run test:native:mac
pnpm run build:native:mac:universal
pnpm run release:check
```

`release:check` rejects a missing, thin, or malformed Mac helper; on macOS it also verifies the executable bit and signature. The build copies precompiled helpers into `dist/native`, excluding C#/PowerShell/Swift source. CI builds Windows artifacts before its cross-platform checks, compiles/tests Swift on macOS, checks a universal artifact, and tests installed ESM/CommonJS consumers. Package verification uses a real tgz, not repository self-reference.

The user has confirmed Mac demo capture and snapping after system-window filtering. Signed-app distribution, both CPU architectures on real hardware, and the full Lark/browser/Ping matrix still need release validation; simulated tests are not hardware acceptance. See [implementation and validation notes](https://github.com/electron-tools/electron-snapora/blob/main/docs/macos-container-snap.md).

## License and trademarks

The source code is licensed under the [MIT License](https://github.com/electron-tools/electron-snapora/blob/main/LICENSE). The `electron-snapora` name and official project branding are governed separately by the [Trademark Policy](https://github.com/electron-tools/electron-snapora/blob/main/TRADEMARKS.md). Modified versions remain permitted under MIT, but they must not impersonate an official release or use project branding in a confusing way.
