# Sonolect Product Specification

Last updated: 2026-05-03

---

## Vision

Sonolect is a **privacy-first, offline-capable voice-to-text desktop tool** that gives professionals full control over their audio recordings and transcripts — without sending a single byte to the cloud unless they choose to.

---

## Target Users

| Persona                           | Need                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| **Journalists & researchers**     | Accurate, private transcription of interviews and field recordings |
| **Freelancers & consultants**     | Quick meeting notes with easy export to docs and project tools     |
| **Legal & medical professionals** | Strict data-residency and retention requirements                   |
| **Privacy-conscious individuals** | Local-only workflow with no third-party data sharing               |
| **Multilingual teams**            | Seamless language switching (starting with English and French)     |

---

## Core Features

### Voice Capture

- System and microphone audio capture with device selection
- Real-time waveform visualisation
- Configurable sample rate and format (WAV / Opus)

### Local Speech-to-Text

- Embedded Whisper-based STT engine — runs entirely on-device
- Automatic language detection with manual override
- Streaming partial results during recording

### Transcript Editing

- Inline text corrections with undo/redo
- Segment merge, split, and reorder
- Speaker label assignment and colour coding
- Timestamp-linked playback (click a segment to jump to audio)

### Internationalization (i18n)

- Full UI localisation: English and French at launch
- Pluggable locale files — community contributions welcome
- Date, time, and number formatting respects active locale

### Privacy Controls

- **No telemetry by default** — opt-in analytics only
- Configurable audio retention (auto-delete after N days or manual purge)
- One-click "Delete all my data" action
- All processing local unless cloud sync is explicitly enabled

### Export

- Plain text, Markdown, JSON
- Subtitle formats: SRT, VTT
- Clipboard copy with formatting preserved
- Future: PDF, DOCX, direct integrations

---

## Non-Functional Requirements

### Offline-First

- 100 % of capture, transcription, editing, and export works without a network
- Cloud features (sync, enhanced STT, agents) are additive, never required

### Performance

- UI interactions respond in **< 100 ms** (measured at P95)
- Transcript rendering handles sessions up to 4 hours without jank
- App cold-start target: **< 3 seconds** on mid-range hardware

### Privacy by Default

- Zero network calls on first launch
- Audio and transcript data stored in user-local directories with OS-level permissions
- Future cloud sync uses end-to-end encryption; server cannot read content

### Reliability

- Crash-recovery: unsaved sessions auto-persist every 5 seconds
- Graceful degradation when STT model files are missing or corrupt

---

## Tech Stack Summary

- **Monorepo**: pnpm workspaces + Turborepo
- **Frontend**: Vite, React 18, Zustand, TailwindCSS
- **Backend services** (Phase 3+): Fastify on Cloud Run
- **Infrastructure**: Terraform → GCP (Firestore, Cloud SQL, Cloud Storage, Pub/Sub)
- **Shared packages**: `@sonolect/types`, `@sonolect/validation`, `@sonolect/config`, `@sonolect/sdk`, `@sonolect/ui`

---

## Competitive Positioning

| Dimension              | **Sonolect**                       | Otter.ai           | Whispr Flow    | macOS Dictation                      |
| ---------------------- | ---------------------------------- | ------------------ | -------------- | ------------------------------------ |
| **Privacy**            | Local-first, zero cloud by default | Cloud-only         | Cloud-required | On-device but Apple ecosystem locked |
| **Offline mode**       | Full functionality                 | None               | None           | Partial (short dictation)            |
| **Transcript editing** | Rich inline editor                 | Basic corrections  | Minimal        | None                                 |
| **Export formats**     | MD, TXT, JSON, SRT, VTT            | TXT, PDF           | TXT            | Clipboard only                       |
| **i18n UI**            | English, French (extensible)       | English-centric UI | English only   | System language                      |
| **Open architecture**  | Monorepo, pluggable STT engines    | Proprietary        | Proprietary    | Proprietary                          |
| **Price**              | Free local tier; paid cloud add-on | Subscription       | Subscription   | Free (Apple only)                    |

**Key differentiator:** Sonolect is the only tool that combines **production-grade transcription editing** with **complete offline operation** and **zero-trust privacy defaults** — no account required, no data leaves the device.

---

## Success Metrics

- **Adoption**: 1 000 active local users within 6 months of public beta
- **Quality**: STT word-error rate < 10 % on English conversational audio (Whisper large-v3)
- **Performance**: P95 UI latency < 100 ms across all core workflows
- **Retention**: 40 % weekly-active / monthly-active ratio
