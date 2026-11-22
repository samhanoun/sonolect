# Sonolect Product Specification

Last updated: 2026-11-22

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

- System and microphone audio capture with device selection. On desktop, Settings › Microphone picks the input and tests its level without recording.
- This computer's sound as the source of a recording on desktop (a meeting, a video): Settings › Microphone › Record from. On Windows it needs nothing else, since the app records the default playback device through WASAPI loopback. On Linux it needs PulseAudio or PipeWire with `pactl` and `parec`; on macOS it needs the BlackHole audio driver and `ffmpeg`. The choice is only offered where it can work. A dictation shortcut pressed while Sonolect is in front starts a Studio recording, which follows Record from. Dictation into other apps and the bubble always use the microphone: what is pasted there is your own words.
- Real-time waveform visualisation, driven by the microphone level
- Recordings of up to four hours on desktop. The audio is written to disk while you speak, so nothing is lost if the app stops, and it is transcribed at each pause.
- Recordings are stored at 16 kHz mono, the format the speech engine works with, as WAV or as Ogg Opus at about a tenth of the size (Settings › Privacy & retention › Save recordings as). Compressed recordings play back from the Opus file itself, or as WAV where the system cannot play Opus, and can be transcribed again.
- High quality, the third choice there, keeps live recordings (microphone and computer sound) as 48 kHz Ogg Opus, in stereo when the source has it: 96 kbit/s in stereo, 64 kbit/s in mono, about 175 MB for four hours of stereo. The speech engine still gets 16 kHz mono, written beside it as a WAV that is deleted when the recording ends. Should the 48 kHz copy fail to be written (a full disk, say), the recording goes on and is kept in speech quality. Microphone voice processing stays on. Imported files stay in speech quality. Online speech models still receive only 16 kHz mono; the high-quality audio never leaves the device.
- Save audio, on each recording in the Library, downloads the file the recording is kept as (its Opus file, or its WAV), the way a transcript is exported. It is read from the device; nothing is uploaded. A note that came through sync has no audio here, so it has no Save audio.

### Dictate Anywhere

- **Desktop:** a floating dictation bubble, a small always-on-top glass pill that never takes focus. The global hotkeys (Ctrl+Shift+M to toggle, Ctrl+Shift+V to hold; Cmd instead of Ctrl on macOS) dictate into whatever app is in front, and the polished text is pasted there when it's done. Esc cancels a dictation. A recording started in the Studio shows on the pill too, where it can be stopped but never discarded, and Esc stays with the app you are in. Settings › Dictation bubble shows it always, only while dictating, or never.
- **Android:** the Sonolect voice keyboard, an input method with one big mic that types into any app. It recognizes speech on the phone, and uses the system speech service only where the app's privacy settings allow it without asking.
- **iOS:** Quick dictation (`sonolect://dictate`) opens straight into listening and copies the polished text for pasting. iOS keyboards can't use the microphone, so this is the closest equivalent. It can be bound to the Action button or Back Tap through Shortcuts.

### Local Speech-to-Text

- Embedded Whisper-based STT engine — runs entirely on-device
- Automatic language detection with manual override
- Streaming partial results during recording: on desktop the text heard so far appears while you are still speaking, and long audio files are imported the same way, piece by piece

### Transcript Editing

- Inline text corrections with undo/redo
- Segment merge, split, and reorder
- Speaker label assignment and colour coding, with a legend that renames a speaker on every segment at once
- On-device speaker detection on desktop: **Detect speakers** labels the segments of a saved recording Speaker 1, Speaker 2 and so on, in one undo step. The number of speakers is found automatically or chosen (2 to 8), and names you typed are kept unless you choose to replace them. Its 28 MB model is downloaded once, only after you agree, and the audio never leaves the device. A note that came through sync has no audio here, so it is not offered there.
- Timestamp-linked playback (click a segment to jump to audio)

### Internationalization (i18n)

- Full UI localisation: English and French at launch
- Pluggable locale files — community contributions welcome
- Date, time, and number formatting respects active locale

### Privacy Controls

- **No telemetry by default** — opt-in analytics only. One exception on Android: the library behind the sync QR code scanner, Google ML Kit, sends Google usage and diagnostic data (such as the device model, the app version and how long a scan took), never the camera images or the code it reads
- Configurable audio retention (auto-delete after N days or manual purge). Choosing a shorter period asks first when it would delete recordings right away.
- One-click "Delete all my data" action
- All processing local unless the user turns on a cloud feature: note sync, which sends only end-to-end encrypted notes, or online editing with their own provider key, which asks before each note is sent unless the user turns on Send without asking (never in Ephemeral)

### Sync Between Your Devices

- Notes sync between the user's own computers and phones, **end-to-end encrypted**: the server stores them but cannot read them. There is no account: a random key is created on the first device and given to the others by QR code or a 56-character code. Whoever holds the code can read every note, so every screen that shows or accepts it says so.
- Notes only. Recordings stay on the device that made them, so a synced note may have no audio.
- Off until the user turns it on. Turning it off keeps the notes and either keeps the server copy for the other devices or deletes it. **Delete all my data** also forgets the sync key, and offers to delete the server copy first.
- Local retention (auto-delete after N days) stays local: it never deletes a note on the other devices, and a device does not bring in notes older than its own retention window. Deleting a note by hand deletes it everywhere.
- **Status: built, hidden until hosted.** Both apps contain sync, but show none of it, and make no sync request, unless the build names a sync server. The server runs on Google Cloud (Cloud Run and Firestore); [sync-setup.md](sync-setup.md) is the owner's runbook, and [security.md](security.md#note-sync) the threat model.

### Export

- Plain text, Markdown, JSON
- Subtitle formats: SRT, VTT
- A recording's audio, as the Opus or WAV file it is kept as (desktop Library › Save audio)
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

- Zero network calls on first launch. The speech and speaker models are downloaded only when you ask for them, and each download must match the size and SHA-256 pinned in the app.
- Audio and transcript data stored in user-local directories with OS-level permissions
- Note sync is end-to-end encrypted: the server cannot read content, and sees only ciphertext, sizes, times, IP addresses and opaque ids

### Reliability

- Crash-recovery: unsaved sessions auto-persist every 5 seconds
- Graceful degradation when model files are missing or corrupt: a speaker model that no longer matches its checksum is removed, and its download is offered again

---

## Tech Stack Summary

- **Monorepo**: pnpm workspaces + Turborepo
- **Frontend**: Vite, React 18, Zustand, TailwindCSS
- **Backend services** (Phase 3+): Fastify on Cloud Run
- **Infrastructure**: Terraform → GCP (Firestore, Cloud SQL when enabled, Cloud Storage, Pub/Sub)
- **Shared packages**: `@sonolect/types`, `@sonolect/validation`, `@sonolect/config`, `@sonolect/sdk`, `@sonolect/sync-core`, `@sonolect/ui`

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

**Key differentiator:** Sonolect is the only tool that combines **production-grade transcription editing** with **complete offline operation** and **zero-trust privacy defaults**. No account is required, and no data leaves the device unless the user turns on a cloud feature, such as end-to-end encrypted sync or online editing with their own provider key.

---

## Success Metrics

- **Adoption**: 1 000 active local users within 6 months of public beta
- **Quality**: STT word-error rate < 10 % on English conversational audio (Whisper large-v3)
- **Performance**: P95 UI latency < 100 ms across all core workflows
- **Retention**: 40 % weekly-active / monthly-active ratio
