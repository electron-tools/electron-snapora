# Implementation Plan: npm release readiness

Branch: main
Created: 2026-08-20

## Settings

- Testing: yes
- Logging: standard
- Docs: yes

## Tasks

### Phase 1: Release contract

- [x] Task 1: Update `README.md`, `docs/plan.md`, and `CHANGELOG.md` with the verified package status, remaining owner decisions, and the alpha-before-latest policy. Logging: document the release commands and their success/failure output; no runtime logging changes. Dependencies: none.
- [x] Task 2: Add `publishConfig`, npm lifecycle hooks, and a standard-library-only release metadata validator in `package.json` and `scripts/`. Logging: emit concise `[release]` pass/fail messages without credentials or tokens. Dependencies: Task 1.

### Phase 2: Automation

- [x] Task 3: Add a GitHub Actions CI baseline for Windows, macOS, and Linux quality checks, plus Windows package-consumer checks, without enabling automatic publication. Logging: retain command output as the CI diagnostic record; do not print secrets. Dependencies: Task 2.
- [x] Task 4: Run lint, typecheck, tests, build, pack dry-run, consumer checks, and the intentionally blocking release metadata gate. Logging: capture failing gate reasons as owner decisions, not as hidden warnings. Dependencies: Tasks 1-3.
