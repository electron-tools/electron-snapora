# Changelog

All notable changes to this project will be documented in this file.

## [1.0.10] - 2026-08-27

### Changed

- Keep filled text backgrounds aligned with the textarea content bounds after commit, movement, and style updates.
- Use high-contrast foreground colors consistently for filled and shadow text presets in the editor, preview, and Canvas output.

### Fixed

- Prevent filled text from shifting or resizing after Enter commits the annotation by preserving its exact content-area bounds.
- Keep filled text bounds synchronized when the annotation is translated and cover the geometry and rendering regressions with focused tests and smoke assertions.

## [1.0.9] - 2026-08-26

### Changed

- Replace the user-facing text outline preset with a high-contrast shadow preset while retaining rendering compatibility for existing outline annotations.

### Fixed

- Keep annotation tooltips above neighboring toolbar panels and automatically place them above or below the toolbar based on the available screen space.
- Include the shadow decoration in text bounds and align the preset preview, active text editor, Canvas rendering, and smoke coverage with the new style.

## [1.0.8] - 2026-08-24

### Added

- Allow rectangle, ellipse, arrow, brush, text, and mosaic tools to drag the topmost existing annotation directly while keeping the active drawing tool selected.
- Add an opt-in `showCopyFeedback` capture option; the standalone post-copy confirmation window remains disabled by default.
- Make pinned screenshots proportionally resizable with a menu-safe 176 px minimum width and height.

### Changed

- Use outline-aware hit testing and a 4 px drag threshold for direct annotation movement while preserving the selection tool's full-bounds behavior.
- Keep pinned screenshots at the highest standard always-on-top level until closed without stealing focus from the host window.
- Keep the Windows capture Overlay transparent while it takes control of the cursor before direct desktop-stream capture.

### Fixed

- Show a theme-accent boundary while text or mosaic annotations are directly dragged, without exposing resize handles.
- Preserve the current resized pinned-window dimensions during long high-DPI drags and keep the custom context menu fully visible at the minimum size.
- Prevent macOS pinned screenshots from hiding the host window or Dock by avoiding cross-Space process-type changes and initial focus stealing.
- Align the README with the current freeform-selection behavior after window snapping was disabled.

## [1.0.7] - 2026-08-24

### Added

- Add a prepared Windows desktop-source capture path that sends a cached source ID to the isolated Overlay and draws the first MediaStream frame directly to Canvas.
- Add an automatic per-session fallback to the legacy image capture path when the direct desktop stream cannot provide a frame.

### Changed

- Prewarm Windows screen sources after Electron app readiness and reuse cached source IDs to reduce repeat-capture latency.
- Upgrade the internal screenshot IPC protocol to version 2 while keeping custom capture adapters that return image frames compatible.
- Add a trademark policy while keeping the source code under MIT, and clarify GitHub Issue and X support channels in the English and Chinese README files.

### Fixed

- Hide the system cursor while the Windows direct-capture frame is being prepared so the click-position cursor is not baked into the screenshot.
- Stop and release desktop MediaStreams when a frame is replaced, times out, is aborted, or the Overlay page is hidden.
- Use the captured video's actual pixel dimensions for Canvas rendering, selection geometry, and exported PNG output.

## [1.0.6] - 2026-08-24

### Changed

- Simplify the capture instruction to describe the current drag-to-select interaction in English and Chinese.

### Fixed

- Clip annotations to the live selection bounds while the screenshot region is moved or resized.
- Match the active text editor border to the screenshot selection accent color.

## [1.0.5] - 2026-08-22

### Changed

- Strengthen npm discovery metadata with an explicit Electron screenshot plugin description and focused screenshot, capture, annotation, and pin-to-screen keywords.
- Keep the overlay interaction model freeform by disabling window snapping/attach behavior while preserving normal region selection.

### Fixed

- Center the capture instruction prompt so it appears in the viewport instead of floating at the screen edge during the ready state.
- Delay overlay reset until the screenshot window is actually hidden, avoiding visible flashes and stale previous-frame remnants when reusing the capture layer.
- Clear cached frame and canvas data between sessions so a new capture does not briefly reveal the previous screenshot.
- Remove the initial "Preparing screenshot…" prompt before selection begins so the overlay stays clean and unobtrusive.
- Restore valid CSS typing for the overlay stylesheet in TypeScript/Vite editors so the project stays build-clean in the editor environment.

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
