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

## Security Baseline

Never log audio, full transcripts, selected text, private generated responses, tokens, API keys, payment data, signed URLs, or prompts containing sensitive user data.
