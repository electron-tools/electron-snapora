# electron-snapora — Electron screenshot and annotation toolkit

[English](https://github.com/electron-tools/electron-snapora/blob/main/README.md) | [简体中文](https://github.com/electron-tools/electron-snapora/blob/main/README.zh-CN.md) | [日本語](https://github.com/electron-tools/electron-snapora/blob/main/README.ja.md) | [한국어](https://github.com/electron-tools/electron-snapora/blob/main/README.ko.md) | [Español](https://github.com/electron-tools/electron-snapora/blob/main/README.es.md)

Add region screenshot capture, a snipping overlay, annotations, clipboard copy, and PNG export to Electron applications.

## Features

- Electron screenshot and screen capture.
- Region capture with an interactive snipping overlay.
- Screenshot editing with rectangle, ellipse, arrow, brush, text, and mosaic annotations.
- Clipboard copy and native PNG save.
- TypeScript, ESM, and CommonJS support.

Repository: [github.com/electron-tools/electron-snapora](https://github.com/electron-tools/electron-snapora)

## Quick start

Requirements: Node.js 20 or newer and Electron `>=42 <44`.

### 1. Install

```bash
npm install electron-snapora
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
strokes, text, or mosaic, then copy or save the final PNG. `Escape` cancels. The result is always one
of `completed`, `cancelled`, or `failed`, so callers do not need exception-based control flow for
normal user actions.

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

### Theme and localization

The overlay defaults to English (`en-US`) and a dark toolbar. A capture can select the built-in
Chinese locale, override individual messages, and provide semantic theme colors:

```ts
await window.electronSnapora.capture({
  locale: 'zh-CN',
  messages: {
    confirm: '复制到聊天框',
    copied: '截图已复制',
  },
  theme: {
    mode: 'light',
    accentColor: '#6750a4',
    accentForegroundColor: '#ffffff',
    toolbarBackground: 'rgb(250 250 250 / 96%)',
    toolbarForeground: '#1d1b20',
    tooltipBackground: '#27272a',
    warningColor: '#f59e0b',
  },
});
```

Message resolution is deterministic: English baseline, selected built-in locale, then host
overrides. This means a partial `messages` object always falls back to a complete accessible
label set. Unknown message or theme keys, empty messages, and unsupported modes are rejected at
the main-process IPC boundary.

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
parallel with `capture()` and only primes or reveals it after the captured frame is ready. The
resolved display must match the first frame returned by the following `capture()` call. Adapters
that omit this method keep the compatible capture-then-load sequence.

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

electron-builder can package the complete dependency inside ASAR; these JavaScript, HTML, and CSS
resources do not require `asarUnpack`. If a bundler inlines the package or packaging excludes part
of `dist`, resource resolution throws an `[electron-snapora] Packaged resource missing` error with
the expected path instead of waiting on a blank Overlay.

For Electron Forge, keep the package in `dependencies`; add the same external rule to the Forge
Vite or Webpack main-process config. Forge projects that use pnpm should use a hoisted
`node_modules` layout because Forge discovers production dependencies from the physical dependency
tree.

### Published package contents

The npm package contains only the compiled ESM/CommonJS entry points, TypeScript declarations,
Preloads, Overlay HTML/CSS/JavaScript, package metadata, README, changelog, and license. Source files,
tests, demos, repository documentation, CI configuration, and release scripts are not published.

## Support baseline

The npm peer range is intentionally limited to Electron `>=42 <44`. The package is built for a
Node.js 20 baseline and has passed the real capture/Overlay lifecycle on Windows 11 x64 with
Electron 42.8.0 and 43.3.0.

| Environment                                      | Status                                                  |
| ------------------------------------------------ | ------------------------------------------------------- |
| Windows 11 x64, Electron 42.8/43.3               | Automated and manually exercised                        |
| Windows ARM64                                    | Pending hardware validation                             |
| macOS, Retina and signed app                     | Code/tests complete; signed hardware validation pending |
| Linux X11 / XWayland / native Wayland / PipeWire | Not yet declared supported                              |

Electron officially supports only its latest three stable major lines. This package does not claim
compatibility with an Electron version merely because installation succeeds; the peer range is
expanded only after its capture, Overlay, preload, and packaging matrix passes. Native Wayland is
especially not assumed equivalent to X11 because Electron documents limitations in its Screen API.

### macOS permission

macOS 10.15 and later requires Screen Recording consent. When the operating system reports
`denied` or `restricted`, capture returns `PERMISSION_DENIED`; the user must enable the signed host
application under System Settings → Privacy & Security → Screen Recording and restart it. Test the
permission using the signed application identity, not only Electron launched from a terminal.

Add a screen-capture purpose string to the packaged host. For electron-builder:

```json
{
  "build": {
    "mac": {
      "hardenedRuntime": true,
      "extendInfo": {
        "NSScreenCaptureUsageDescription": "Capture a selected screen region for sharing."
      }
    }
  }
}
```

With `display: 'cursor'`, Snapora resolves the display under the pointer once at task start and keeps
that display ID through capture and Overlay creation. If the monitor is disconnected or its geometry
or scale changes during startup, the task fails with `DISPLAY_NOT_FOUND` and should be retried instead
of displaying a screenshot on the wrong monitor.

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
