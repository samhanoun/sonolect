# Sonolect vs Wispr Flow Gap Audit

Date: 2026-05-06

## Audit scope

This audit checked:

- Current `main` branch state in `/home/test/sonolect`.
- Desktop app live UI via Vite at `http://127.0.0.1:5183`.
- Desktop settings, command palette, record button error state, and transcript detail/editor flows.
- Product/roadmap docs and test inventory.
- Public Wispr Flow marketing/product references from `https://wisprflow.ai/`.
- Local verification: `format:check`, `typecheck`, and `test`.

## Verification snapshot

- Local branch: `main`, pulled from origin before audit.
- Existing open issues at audit start:
  - #12 `feat(e2e): real voice-to-transcript E2E tests`
  - #7 `chore(ci): address GitHub Actions Node 20 deprecation warnings`
- Local checks passed:
  - `npx --yes pnpm@9.15.0 format:check`
  - `npx --yes pnpm@9.15.0 typecheck`
  - `npx --yes pnpm@9.15.0 test`
- Test footprint observed:
  - Desktop: 84 unit/helper tests passing.
  - Mobile: 12 tests passing.
  - API/worker/service smoke tests passing.
  - E2E files exist for desktop home and voice capture readiness.

## Wispr Flow target evidence

Public Wispr Flow positioning emphasizes:

- `Don’t type, just speak`.
- Voice-to-text AI that turns speech into clear, polished writing in every app.
- Mac, Windows, iPhone, and Android availability.
- Seamless speech-to-text in every application on phone or computer.
- 4x faster than typing; public examples show about 45 WPM keyboard vs 220 WPM Flow.
- AI auto edits: removes filler words, fixes grammar, formats rambling speech into polished text.
- Personal dictionary that learns unique words/names.
- Snippet library for repeated phrases and team text shortcuts.
- 100+ languages with automatic detection.
- Cross-device sync of dictionary, style, and settings.
- Use-case positioning for teams, students, developers, creators, sales, support, lawyers, leaders, and accessibility.
- Trust/compliance positioning: HIPAA-ready language and SOC 2 Type II for enterprise.

## Sonolect implementation observed

### Strong foundations already present

- Clear app branding: Sonolect / Voice OS.
- Strong desktop shell visual direction: dark, glassy, premium dashboard.
- Clear positioning: `Voice capture → text → actions`.
- Offline/local-first signal is prominent.
- Primary `Record now` CTA with visible shortcut hints.
- Command palette affordance with commands:
  - New voice capture.
  - Open history.
  - Privacy settings.
- Dictation history list and cards.
- Transcript detail view with:
  - Editable transcript textarea.
  - Segment editor.
  - Speaker labels.
  - Merge/split controls.
  - Undo/redo controls.
  - Copy/download/export buttons.
  - MD/SRT/VTT/JSON export buttons.
  - Transform button.
- Settings include:
  - Local/cloud privacy toggle.
  - Locale toggle EN/FR.
  - STT language selector with many languages.
  - Local API configuration status.
  - Local Whisper setup guidance and command validation.
- Tests cover desktop helpers, local Whisper bridge, export, transcript editing, persistence, mobile local API, worker daemon, and API upload/transcript smokes.

### Important observed UX issues

- Initial attempt to open port `5173` showed an unrelated `OpenClaw Deck` app. Correct Sonolect was on `5183`. This is a local dev environment/port-confusion risk, not necessarily app code, but it can derail QA.
- Clicking `Record now` in browser audit immediately produced `Error: Requested device not found`. The app surfaces the error, but the user-facing recovery/onboarding is thin.
- Settings still displays example paths such as `/home/you/.local/share/sonolect/...` in guidance. Prior work avoided persisting them, but visually they still look like literal paths a user might copy incorrectly.
- The home screen duplicates sidebar history and main history; the main workspace is not yet the active dictation/output flow.
- The command palette has only three commands and is more of a stub than a complete control surface.
- `fallback offline` labels are visible but not explained well enough for users.

## Gap matrix vs Wispr Flow goal

### P0 — Core Wispr Flow parity gaps

1. Global dictation overlay and hotkey lifecycle
   - Wispr target: speak in every app with a lightweight overlay.
   - Sonolect today: in-app dashboard CTA; no visible floating global overlay; no OS-level shortcut lifecycle verified.
   - Needed: tray/menu bar app, global hotkey registration, floating recorder state, cancellation, retry, and result confirmation.

2. Insert polished text into the current app
   - Wispr target: text appears where the user is working.
   - Sonolect today: transcript lives inside Sonolect; copy/export exists, but not direct insertion.
   - Needed: accessibility/input permissions, cursor target detection where possible, paste/type fallback, clipboard fallback, insertion success/error states.

3. AI auto-edit pipeline
   - Wispr target: rambling speech becomes clean writing with filler removal, grammar fixes, formatting, and tone preservation.
   - Sonolect today: deterministic/local transform helpers exist, but no robust style/intent pipeline.
   - Needed: raw transcript → polished output diff/preview, presets, one-click accept/insert, local/offline fallback, optional cloud model later.

4. First-run onboarding and permission setup
   - Wispr target: install, grant permissions, press shortcut, dictate anywhere.
   - Sonolect today: settings page exists, but no guided onboarding wizard.
   - Needed: mic test, local model check/download guidance, shortcut setup, accessibility/input permission setup, privacy explanation, sample dictation.

5. Real device E2E / hardware QA
   - Wispr target: dependable across actual desktop environments.
   - Sonolect today: mocked Playwright media tests and code-level smokes; #12 remains open for real voice-to-transcript E2E.
   - Needed: hardware/OS test plan plus scripted real-mic or fixture-driven Tauri smoke where possible.

### P1 — Product completeness gaps

6. Personal dictionary
   - Wispr target: learns names, product terms, custom vocabulary.
   - Sonolect today: no visible dictionary management.
   - Needed: dictionary CRUD UI, correction capture, STT prompt/context injection where available, tests.

7. Snippet library / voice shortcuts
   - Wispr target: speak a cue and expand formatted repeated text.
   - Sonolect today: no snippet library visible.
   - Needed: snippet CRUD, trigger matching, expansion preview, team-ready data model later.

8. Style profile and rewrite controls
   - Wispr target: synced style/settings; polished output follows user voice.
   - Sonolect today: transform button exists but no style profile UI.
   - Needed: style presets, per-app/use-case templates, concise/professional/casual options, before/after preview.

9. More complete command palette
   - Wispr target: fast control across workflows.
   - Sonolect today: only three visible commands.
   - Needed: record, stop, open recent, search transcripts, copy, insert, export, transform, settings sections, privacy/data commands.

10. Action execution UI
    - Wispr target: create, code, message, write in workflow context.
    - Sonolect today: action labels are mostly metadata; buttons exist for export/copy/transform.
    - Needed: action panel with copy/insert/create task/draft reply/export; clear offline vs cloud capabilities.

11. Cross-platform/mobile parity
    - Wispr target: Mac, Windows, iPhone, Android.
    - Sonolect today: desktop and mobile code/tests exist; product parity appears incomplete.
    - Needed: mobile UI audit, sync/local API UX, consistent dictionary/style/snippets across devices.

12. Search/history depth
    - Wispr target: fast reuse and context everywhere.
    - Sonolect today: recent cards only; history command is placeholder-like.
    - Needed: full-text search, filters, tags, favorites, delete/archive, retention controls.

### P2 — Polish, trust, and scale gaps

13. Settings polish for Whisper setup
    - Replace scary/example shell paths with clearer app-data defaults, copy buttons, validation status, and guided installation steps.

14. Accessibility and contrast pass
    - Validate WCAG labels, contrast, focus states, keyboard-only flows, reduced motion.

15. Metrics aligned to user value
    - Current insights are words/WPM/streak. Wispr-style value should expose time saved, insertions, transformations, corrections avoided, and latency.

16. Privacy/data controls
    - Product spec promises retention and one-click delete. Settings says deletion after 24h, but full user-visible retention/purge controls need verification/implementation.

17. Release/update production readiness
    - Current CI validates package readiness, but real signed updater release still requires protected secrets and a tag workflow.

## Recommended implementation sequence

### Track A — Wispr-parity capture loop

1. Build floating recorder overlay UI in desktop.
2. Register/configure global shortcut and tray/menu-bar entry.
3. Implement active recording state with timer, waveform, live partial placeholder, cancel/finish.
4. Implement insert-at-cursor with clipboard fallback and permission/onboarding states.
5. Add Playwright/Tauri smoke coverage for overlay state machine and insertion fallback.

### Track B — Polished output loop

1. Add raw → polished transcript preview with visible edits.
2. Add rewrite style presets and use-case templates.
3. Add accept/copy/insert controls.
4. Add personal dictionary and correction capture.
5. Add snippet library with trigger expansion.

### Track C — Product hardening loop

1. Add first-run onboarding wizard.
2. Upgrade command palette to cover all core operations.
3. Add retention/purge controls.
4. Complete real voice-to-transcript E2E (#12).
5. Audit mobile parity and cross-device settings story.

## Bottom line

Sonolect is no longer just scaffolding: it has a credible local-first desktop shell, transcript editing, exports, Whisper setup, local API/worker tests, and a visual identity.

But it is not yet `exactly like Wispr Flow`. Wispr Flow’s core product is ambient dictation in every app with instant auto-edited text insertion. Sonolect is currently closer to a polished offline dictation workspace. The highest-impact next work is to move the core interaction out of the dashboard and into a global overlay + hotkey + insert-at-cursor workflow, then add Wispr-style auto-edits, dictionary, snippets, and onboarding.
