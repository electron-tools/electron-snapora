# Changelog

All notable changes to this project will be documented in this file.

## [1.0.4] - 2026-08-22

### Changed

- Reuse the loaded screenshot Overlay window and Renderer on repeated captures of the same display, reducing repeated window creation and page startup work.
- Reset selections, annotations, style controls, watermarks, color-picker state, and output feedback before a reused Overlay starts a new session.
- Rename the primary completion action from "Copy & Done" to the shorter "Done" label.

### Fixed

- Dispose cached Overlay resources when the host unregisters or its owning WebContents is destroyed.
- Dismiss toolbar tooltips while pointer actions are held and dragged away.
- Tighten copy-feedback spacing and checkmark alignment.
- Make release verification cleanup tolerate transient Windows file locks.

## [1.0.3] - 2026-08-22

### Added

- Pin annotated screenshots to independent always-on-top draggable windows with close, copy, save, and multi-window support.
- Contextual annotation preset panels, adjustable mosaic strength, and tiled text watermarks with opacity and color controls.
- Compact text input that grows with its longest line and hover-to-snap window selection.
- Hover-only pinned-window close control and localized in-window copy success feedback.

### Changed

- Replace text-size shortcuts with default, fill, and outline text style presets.
- Match the custom color preset to the fixed swatch size, reuse the standard selected checkmark, and unify pinned-window context-menu icons.
- Replace the system color dialog with a themed HSV picker whose saturation area and hue bar share one width.

### Fixed

- Hide zero-length arrow drafts until dragging establishes a direction.
- Keep pinned-window dimensions stable during long drags on high-DPI Windows displays.
- Keep the text editor and automatically wrapped Canvas text inside the screenshot selection.
- Prevent the pinned-window context menu from showing an initial item selection or browser focus outline.
- Trigger the macOS Screen Recording prompt on first capture and open System Settings after denial.

## [1.0.2] - 2026-08-20

### Changed

- Declare Electron 42 as the minimum peer version without hard-coding the current tested maximum.

## [1.0.1] - 2026-08-20

### Added

- Reusable Electron screenshot lifecycle with an isolated Overlay and typed IPC.
- Region selection, six annotation tools, undo/redo, PNG export, clipboard copy, and native save output.
- ESM/CommonJS entry points and bundled Preloads.
- One-call `setupElectronSnapora()` integration and a task-oriented README quick start.
- English, Simplified Chinese, Japanese, Korean, and Spanish documentation entry points.

### Security

- Top-level sender authorization, strict IPC validation, resource limits, and isolated Overlay execution.

### Compatibility

- Node.js 20 or newer and Electron 42–43.
