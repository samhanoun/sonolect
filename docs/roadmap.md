# Sonolect Development Roadmap

Last updated: 2026-05-03

---

## Phase 1 — Local MVP ✅

**Timeline:** Q1 2026 (complete)

Core desktop application with fully offline voice-to-text capabilities.

**Key deliverables:**

- Desktop app shell (Vite + React + Zustand)
- Local audio capture pipeline with device selection
- Integrated local STT engine (Whisper-based, no network required)
- Basic transcript viewer with timestamped segments
- Session persistence using local storage / SQLite
- Futuristic dark UI theme with foundational component library (`@sonolect/ui`)
- Monorepo scaffolding: pnpm workspaces, Turborepo, shared packages (`types`, `validation`, `config`)
- Initial build & lint CI pipeline

---

## Phase 2 — Polish & UX 🔄

**Timeline:** Q2 2026 (in progress)

Refine the editing experience, expand language support, and harden privacy controls.

**Key deliverables:**

- **Transcript editing** — inline corrections, segment merge/split, speaker label assignment
- **Internationalization (i18n)** — full en/fr coverage; pluggable locale system for future languages
- **Privacy controls** — configurable audio retention, one-click purge, opt-in analytics toggle
- **Export** — Markdown, plain text, SRT/VTT subtitle formats, JSON
- **Accessibility** — keyboard navigation, screen-reader labels, WCAG 2.1 AA contrast
- **Performance** — sub-100 ms UI interactions, lazy chunk loading, efficient waveform rendering
- **Testing** — unit/integration coverage ≥ 80 %, Playwright end-to-end smoke suite
- **Documentation** — architecture, product spec, roadmap, contributor guide

---

## Phase 3 — Cloud Integration

**Timeline:** Q3–Q4 2026

Optional cloud layer for sync, collaboration, and enhanced transcription accuracy.

**Key deliverables:**

- **GCP infrastructure** — Cloud Run API + Worker services, Firestore, Cloud SQL, Cloud Storage, Pub/Sub (Terraform-managed across dev/staging/prod)
- **Auth & identity** — Firebase Auth or OAuth 2.0, tenant-scoped data isolation
- **Cloud STT fallback** — optional server-side transcription for higher accuracy or unsupported languages
- **Session sync** — end-to-end encrypted upload/download of sessions and audio artifacts
- **Agent framework** — async agent actions pipeline via Pub/Sub for summarisation, action-item extraction, keyword tagging
- **Billing integration** — usage metering, Stripe webhooks, plan enforcement
- **Monitoring** — Cloud Monitoring dashboards, SLO alerts, structured logging

---

## Phase 4 — Team & Enterprise

**Timeline:** 2027

Multi-user collaboration, administration, and compliance features for organisations.

**Key deliverables:**

- **Workspace & teams** — shared projects, role-based access (owner / editor / viewer)
- **Real-time collaboration** — live transcript cursors, concurrent editing with CRDT conflict resolution
- **Admin console** — user management, usage analytics, audit log
- **SSO & directory sync** — SAML 2.0 / OIDC, SCIM provisioning
- **Data residency** — region-pinned storage, EU / US / custom region selection
- **Compliance** — SOC 2 Type II readiness, GDPR data-subject request tooling, retention policies
- **On-premise option** — Docker Compose / Kubernetes deployment for air-gapped environments
- **API & integrations** — public REST/gRPC API, Zapier/Make connectors, calendar & meeting-tool hooks

---

## Guiding Principles

1. **Offline-first** — every core feature must work without a network connection.
2. **Privacy by default** — audio and transcripts never leave the device unless the user opts in.
3. **Incremental cloud** — cloud features enhance but never gate the local experience.
4. **Ship small, ship often** — two-week release cadence with feature flags for progressive rollout.
