# Implementation Plan: Pin screenshot to screen

Branch: main
Created: 2026-08-21

## Settings

- Testing: yes, use existing checks and a retained Electron smoke script; do not create persistent `*.test.ts` files
- Logging: existing structured output diagnostics
- Docs: yes

## Tasks

### Phase 1: Pin output contract

- [x] Task 1: Add `pin` as a validated screenshot output action and public result metadata, plus localized toolbar text and a vertical pin icon. Dependencies: none.
- [x] Task 2: Export the annotated selection through the existing PNG pipeline when the pin button is clicked, then finish the screenshot session with a pinned result. Dependencies: Task 1.

### Phase 2: Pinned window

- [x] Task 3: Add an internal isolated pinned-image window at the selected screen bounds with preserved aspect ratio, always-on-top behavior, whole-window dragging, click-to-front, and a circular close button. Dependencies: Task 2.
- [x] Task 4: Add native right-click actions for copy, download, and close; keep independent window/image state so multiple pinned screenshots can coexist. Dependencies: Task 3.

### Phase 3: Verification and documentation

- [x] Task 5: Add Electron smoke coverage for the full screenshot-to-pin flow plus direct multiple-window rendering, drag, focus, circular close control, and cleanup; do not add or retain new `*.test.ts` files. Dependencies: Tasks 1-4.
- [x] Task 6: Update README, changelog, internal plan, package resource baseline, then run format, lint, typecheck, existing tests, build, pin smoke, and package checks. Dependencies: Task 5.
