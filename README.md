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

### Desktop local Whisper

The Tauri app can transcribe in-process/offline by invoking a local Whisper-compatible command that prints either plain transcript text or JSON with `text`, `language`, and `segments` to stdout. Configure it with an argv JSON array so audio paths and language are passed without shell interpolation:

```bash
export SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS='["/usr/local/bin/sonolect-whisper", "{audioPath}", "--language", "{language}"]'
pnpm --filter @sonolect/desktop tauri dev
```

Supported placeholders: `{audioPath}`, `{mimeType}`, `{language}`, `{durationMs}`. If the desktop command is unavailable, the app falls back to the configured local API path and then to offline retention.

## Security Baseline

Never log audio, full transcripts, selected text, private generated responses, tokens, API keys, payment data, signed URLs, or prompts containing sensitive user data.
