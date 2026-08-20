# Changelog

All notable changes to this project will be documented in this file.

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
