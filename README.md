# electron-snapora

Framework-agnostic screenshot and annotation toolkit for Electron applications.

## Status

The main-process screenshot lifecycle, interactive region selection, six annotation tools, native
save dialog, clipboard output, and PNG export are implemented. The package captures the requested
display, opens an isolated overlay, validates its IPC messages, and settles each job exactly once.

## Goals

- Fast integration into Electron applications.
- A framework-independent TypeScript and Canvas drawing core.
- A self-contained screenshot overlay that does not depend on the host UI stack.
- No native addon or post-install compilation in the default package.
- A narrow, typed IPC contract between renderer and main processes.
- PNG output without coupling the package to storage, upload, or product logic.

## Package entry points

```ts
import { ScreenshotManager } from 'electron-snapora/main';
import { exposeScreenshotApi } from 'electron-snapora/preload';
import { normalizeRect } from 'electron-snapora/core';
```

## Minimal integration

Main process:

```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import {
  ScreenshotManager,
  registerScreenshotIpc,
  resolveHostPreloadPath,
} from 'electron-snapora/main';

const screenshotManager = new ScreenshotManager();

app.whenReady().then(() => {
  const unregister = registerScreenshotIpc({
    ipcMain,
    manager: screenshotManager,
  });

  const window = new BrowserWindow({
    webPreferences: {
      preload: resolveHostPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  app.once('before-quit', unregister);
});
```

If the application already has its own preload, import the helper there instead:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { exposeScreenshotApi } from 'electron-snapora/preload';

exposeScreenshotApi({ contextBridge, ipcRenderer });
```

Sandboxed preload scripts cannot load arbitrary npm modules at runtime. Existing host preloads
must therefore be bundled by the application's build tool. `resolveHostPreloadPath()` points to
the package's pre-bundled default preload and needs no additional configuration.

### IPC sender authorization

`registerScreenshotIpc()` always rejects iframe calls. By default it also accepts only a top-level
page loaded through `BrowserWindow.loadFile()`. Applications that use a custom protocol or a local
development server must explicitly authorize that origin:

```ts
const unregister = registerScreenshotIpc({
  ipcMain,
  manager: screenshotManager,
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

The package still enforces the top-level-frame rule when a custom validator is present.
`ScreenshotOptions` are parsed again in the main process; unknown fields, invalid enum values,
oversized strings, and inconsistent `tools` / `defaultTool` combinations return an
`INVALID_REQUEST` result without starting screen capture.

Renderer:

```ts
const result = await window.electronSnapora.capture({ display: 'cursor' });

if (result.status === 'completed') {
  // result.data is a PNG Uint8Array.
  // result.bounds is the selected region in global Electron Screen DIP coordinates.
  // result.output.action is "copy" or "save".
  if (result.output.action === 'save') {
    console.log(`Saved to ${result.output.filePath}`);
  }
}
```

Cancel an active task from the same host renderer when its screen or route is leaving:

```ts
const cancelled = await window.electronSnapora.cancel();
```

The pending `capture()` promise then resolves with `{ status: 'cancelled' }`. A task is also
cancelled automatically if the host `WebContents` that started it is destroyed. Custom capture
channels automatically use a matching `<channel>:cancel` channel unless `cancelChannel` is set on
both `registerScreenshotIpc()` and `exposeScreenshotApi()`.

In the overlay, drag on the captured frame to create a region. The region can be moved or resized
from eight handles. Rectangle, ellipse, arrow, brush, text, and mosaic annotations are available;
annotations can be selected, moved, resized, deleted, undone, and redone. Color, line width, and
font size are configurable.

- **Copy & Done** or `Enter`: copy the composited PNG to the operating-system clipboard,
  then return it to the host application.
- **Save**: open Electron's native save dialog, choose a local filename/directory, and write PNG.
- **Escape**: cancel the screenshot task.

CSS interaction coordinates are mapped against the captured frame's actual pixel dimensions, so
the PNG remains aligned on mixed-DPI and high-resolution displays. Dialog, clipboard, and file
system capabilities remain in the main process and are not exposed to the host renderer.

### Host policy injection

Most applications can use `new ScreenshotManager()` without configuration. Applications with a
custom capture source, storage policy, or overlay host can replace those dependencies directly:

```ts
const screenshotManager = new ScreenshotManager({
  captureAdapter: myCaptureAdapter,
  outputAdapter: myOutputAdapter,
  createOverlay: (display) => myOverlayFactory.create(display),
  overlayReadyTimeoutMs: 15_000,
});
```

`captureAdapter`, `outputAdapter`, `createOverlay`, `overlayOptions`, and `ipcMain` are high-level
injection points. `runner` remains available only for applications that need to replace the entire
session lifecycle; when it is supplied, the other default-runner options are ignored.

Resource limits can be lowered per host application:

```ts
const screenshotManager = new ScreenshotManager({
  resourceLimits: {
    maxCapturePixels: 32 * 1024 * 1024,
    maxCaptureDataUrlBytes: 96 * 1024 * 1024,
    maxOutputBytes: 32 * 1024 * 1024,
  },
});
```

Defaults allow 64 Mi pixels, a 192 MiB capture Data URL, and a 64 MiB PNG result. Absolute hard
ceilings are 128 Mi pixels / 256 MiB / 256 MiB. Invalid configuration fails during manager
construction; oversized capture adapters and Overlay output are rejected with
`RESOURCE_LIMIT_EXCEEDED` or `INVALID_REQUEST` before clipboard or disk processing.

### Bundling and packaging

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

Add the renderer type once in the host application:

```ts
import type { ScreenshotRendererApi } from 'electron-snapora/types';

declare global {
  interface Window {
    electronSnapora: ScreenshotRendererApi;
  }
}
```

## Support baseline

The npm peer range is intentionally limited to Electron `>=42 <44`. The package is built for a
Node.js 20 baseline and has passed the real capture/Overlay lifecycle on Windows 11 x64 with
Electron 42.8.0 and 43.3.0.

| Environment                                      | Status                                             |
| ------------------------------------------------ | -------------------------------------------------- |
| Windows 11 x64, Electron 42.8/43.3               | Automated and manually exercised                   |
| Windows ARM64                                    | Pending hardware validation                        |
| macOS, Retina and signed app                     | Implementation present; release validation pending |
| Linux X11 / XWayland / native Wayland / PipeWire | Not yet declared supported                         |

Electron officially supports only its latest three stable major lines. This package does not claim
compatibility with an Electron version merely because installation succeeds; the peer range is
expanded only after its capture, Overlay, preload, and packaging matrix passes. Native Wayland is
especially not assumed equivalent to X11 because Electron documents limitations in its Screen API.

A synthetic high-entropy 3840×2160 PNG stress run on the Windows x64 development host produced a
28,535,687-byte PNG in 273.4 ms with a 399.11 MiB aggregate peak working set. This is a regression
reference, not a guarantee for other hardware; Retina validation remains part of the macOS lane.

### macOS permission

macOS 10.15 and later requires Screen Recording consent. When the operating system reports
`denied` or `restricted`, capture returns `PERMISSION_DENIED`; the user must enable the signed host
application under System Settings → Privacy & Security → Screen Recording and restart it. Test the
permission using the signed application identity, not only Electron launched from a terminal.

### Lifecycle and concurrency

A `ScreenshotManager` runs one global task at a time. A second call resolves with `CAPTURE_BUSY`;
it is not queued. Use one manager for one global screenshot lane, or separate managers only when the
application intentionally supports independent lanes. Call the cleanup returned by
`registerScreenshotIpc()` during app shutdown or main-process hot reload. `cancel()` and host
`WebContents` destruction settle the active task and release Overlay listeners and windows.

### Error results

| Code                      | Meaning                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `CAPTURE_BUSY`            | Another task is active on the manager.                           |
| `INVALID_REQUEST`         | Host/Overlay IPC origin, options, or payload failed validation.  |
| `RESOURCE_LIMIT_EXCEEDED` | Capture or PNG data exceeded a configured limit.                 |
| `PERMISSION_DENIED`       | The OS denied screen capture permission.                         |
| `DISPLAY_NOT_FOUND`       | The requested display or matching capture source is unavailable. |
| `CAPTURE_FAILED`          | Electron could not produce a usable captured frame.              |
| `OVERLAY_LOAD_FAILED`     | Packaged resources, Renderer startup, or preparation failed.     |
| `EXPORT_FAILED`           | Clipboard, save dialog, PNG encoding, or file output failed.     |
| `INVALID_RESULT`          | The Overlay returned an invalid result or lifecycle message.     |
| `UNSUPPORTED_PLATFORM`    | The current OS/display protocol is explicitly unsupported.       |

## Development

```bash
pnpm install
pnpm check
```

Useful commands:

```bash
pnpm dev
pnpm demo
pnpm demo:selection-smoke
pnpm demo:copy-smoke
pnpm demo:stress-4k
pnpm verify:consumers
pnpm verify:bundlers
pnpm verify:electron-matrix
pnpm verify:packaged
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The architecture and staged delivery plan are documented in
[`docs/implementation-plan.md`](docs/implementation-plan.md). Execution status and acceptance
criteria are tracked in [`docs/plan.md`](docs/plan.md).
