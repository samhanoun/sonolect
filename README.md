# Sonolect

**Speak. Refine. Act.**

Sonolect is a premium voice-first desktop and mobile SaaS application for intelligent dictation, AI rewriting, translation, summarization, reply drafting, command execution, synchronized history, user memory, and agent workflows.

## Platforms

- Desktop: Windows, macOS via Tauri + React + TypeScript + Rust
- Mobile: iOS, Android via React Native + Expo
- Backend: GCP Cloud Run services with Firebase Auth, Firestore, Cloud SQL PostgreSQL, Vertex AI Gemini, Google Cloud Speech-to-Text, Stripe billing, Terraform infrastructure

## Repository Layout

```txt
apps/        Desktop and mobile clients
services/    Cloud Run backend services
packages/    Shared UI, types, validation, config, prompts, SDK
infra/        Terraform, Firebase rules, CI/CD definitions
docs/         Product, architecture, security, roadmap and API docs
tooling/      Scripts and generators
```

## Local Development

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

### Desktop native build

```bash
pnpm --filter @sonolect/desktop tauri build
```

The Linux build emits native bundles under:

- `apps/desktop/src-tauri/target/release/bundle/deb/`
- `apps/desktop/src-tauri/target/release/bundle/appimage/`

### Desktop local API and Whisper

Sonolect is local/offline-first on desktop. If `VITE_SONOLECT_API_URL` is set, new captures can be sent to that local HTTP API; if it is not set, captures stay local. The Settings screen shows the active URL/offline state.

The Tauri app can also transcribe offline by invoking a local Whisper-compatible command that prints either plain transcript text or JSON with `text`, `language`, and `segments` to stdout. Sonolect does **not** bundle large Whisper models. Install a binary/wrapper and download a model yourself.

Non-technical setup outline:

- Install one Whisper option:
  - `whisper.cpp` / `whisper-cli`
  - OpenAI Whisper Python package (`python3 -m whisper`)
  - a small `faster-whisper` wrapper script that accepts an audio file and prints JSON/text
- Download a model into a local folder you control, for example `~/Models/ggml-base.en.bin`.
- Open Desktop → Settings → Local Whisper setup.
- Paste a command as a JSON argv array. Use placeholders instead of real temp audio paths.
- Save, validate, then start the app with `SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS` set to the shown JSON value.

Examples:

```bash
# whisper.cpp example
export SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS='["/usr/local/bin/whisper-cli", "--model", "/Users/me/Models/ggml-base.en.bin", "--file", "{audioPath}", "--output-json"]'
pnpm --filter @sonolect/desktop tauri dev
```

```bash
# OpenAI Whisper Python example
export SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS='["python3", "-m", "whisper", "{audioPath}", "--model", "base", "--language", "{language}"]'
pnpm --filter @sonolect/desktop tauri dev
```

```bash
# faster-whisper wrapper example
export SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS='["/usr/local/bin/sonolect-faster-whisper", "--model", "/Users/me/Models/faster-whisper-base", "--audio", "{audioPath}", "--language", "{language}"]'
pnpm --filter @sonolect/desktop tauri dev
```

Supported placeholders: `{audioPath}`, `{mimeType}`, `{language}`, `{durationMs}`. The settings helper also accepts `{audio}` and `{model}` while building previews, but the native bridge currently expands `{audioPath}` for the recorded temp file. If the desktop command is unavailable, the app falls back to the configured local API path and then to offline retention.

## Security Baseline

Never log audio, full transcripts, selected text, private generated responses, tokens, API keys, payment data, signed URLs, or prompts containing sensitive user data.
