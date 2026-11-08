# Sonolect Local — first working development build

**Current build:** see [STUDIO-STATUS.md](STUDIO-STATUS.md) for the redesigned workspace and OpenRouter/OpenCode integration. The notes below describe the initial local-only milestone.

## Run

Open `build/Sonolect Local/Sonolect.exe`. Keep its `models` folder alongside the executable. This copy contains a verified multilingual Whisper Base model; it does not require an account, API key, development server, or a model download to use that model.

1. Open **Speech setup**. Keep **Local only** selected and choose your dictation language.
2. Press **Start recording**, speak, and stop. Alternatively, use Ctrl+Shift+M to toggle recording, or hold Ctrl+Shift+V.
3. Find the result under **Saved recordings**. Use Copy, Edit & format, Retry locally, or Delete.

Microphone permission is required when recording. Shortcuts may conflict with other installed applications. Each recording is limited to three minutes in this build.

Saved audio and raw transcripts live under the current Windows user's local app-data directory, in `com.sonolect.local/captures`. They remain until deleted. Browser preferences and transcript drafts live in the application's webview storage. This build does not encrypt these files itself. The app uses a separate identifier from the source prototypes.

## Implemented

- Real embedded `whisper-rs` CPU recognition, with no production fake transcript backend.
- Selected model/language passed into inference; no external Whisper command or environment variable required.
- Verified model download in the app, plus a bundled model for this local working copy.
- Mono 16 kHz PCM conversion; model context reused between recordings.
- Local-only submission policy, including failure cases and consent revocation before cloud requests.
- Local recording retention before inference, saved error state, retry and deletion.
- Conservative local formatting that preserves meaningful words and paragraphs.
- Protection against releasing push-to-talk while microphone permission is pending.
- In-window recording status; the inherited separate overlay is disabled pending reliable cross-window state and focus work.

## Verification

The native engine transcribed a Windows-generated, approximately five-second English fixture as:

> The local speech engine is working. I like this kind of music.

The result matched exactly, taking about 3.01 seconds including model load on this machine. This is one synthetic fixture, not a general accuracy or performance benchmark. The same engine returned no text for the silence fixture. Both checks used the production native inference implementation and the verified local model; no audio was sent to a provider.

The desktop TypeScript checks and production frontend build pass. Native unit checks and the desktop regression suite are recorded in `native-tests.log` and `all-desktop-tests.log`. Model/check output is under the Git-ignored `local-test` directory.

## Remaining work

- Verify live microphone capture, record/restart/retry, and shortcut behavior in the packaged app with the user's actual hardware.
- Implement and test destination focus tracking and automatic insertion into other apps. For now, use the saved transcript's Copy action. The inherited manual native insertion action is not a verified app-wide dictation workflow.
- Add cancelable native inference, improved local editing/rewriting, streaming, reliable spoken snippets, app context and styles.
- Validate languages beyond the English fixture and profile larger models/GPU acceleration.
- Repair and validate cloud authentication, cloud service configuration, and account sync before enabling a hosted service. The cloud fallback code is opt-in; this copy has no configured cloud account or deployed backend.
- Complete local-history crash/failure tests, encrypted-storage options, retention limits, signing and installer QA.
- Resolve inherited dependency advisories before release. The initial production dependency audit of the full monorepo reported 2 critical and 52 high advisories (including packages outside the local dictation scope). This development build is not a production security sign-off.

Reader and Team are disabled in local mode. Offline semantic rewriting with a local language model and offline TTS are not implemented here. Local processing currently means speech recognition and conservative formatting.

## Rebuild

From PowerShell, run `./scripts/build-local.ps1` (or add `-Release` for an optimized build). Prerequisites: Node 22, Rust, LLVM/libclang, CMake, Microsoft C++ desktop tools, and installed workspace dependencies. The missing Microsoft C++ desktop component was added to this machine during this build.

For a repeatable engine check, run:

```powershell
./build/'Sonolect Local'/Sonolect.exe --transcribe-file ./local-test/speech.wav ./local-test/ggml-base.bin en
```

Source provenance is recorded in `PROVENANCE.md`. The original audited repositories remain unchanged.
