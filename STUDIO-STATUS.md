# Sonolect Studio — 6 November 2026

## Start the Windows build

Open `build/Sonolect Local/Sonolect.exe`. Keep the adjacent `models` folder in place. The bundled Whisper model works without a provider account or internet connection.

## Online models

1. Open **Models & voices → Providers**.
2. Paste your OpenRouter or OpenCode key directly into the app and select **Save key**. Keys are stored in Windows Credential Manager, not browser preferences. Saving a key does not make a paid request or switch processing modes.
3. Load the live catalog. Select separate models under **Speech to text**, **Text to speech**, and **Text editing**.
4. Explicitly select **Cloud enabled** in the header before sending audio or text online. Choose **Local only** to block online content processing.
5. Use **Transcribe** to record/import audio and edit text. Use **Text to speech** to generate, play, and download audio.

OpenRouter supplies the dedicated STT/TTS integrations. OpenCode (formerly Zen, now Console) supplies text editing; the app does not claim it offers dedicated speech endpoints. The current OpenCode inference endpoints were checked against its November documentation. OpenCode free-tier chat models may be restricted to the OpenCode client; external applications need an eligible paid model/account or subscription.

Speech output supports MP3 and PCM wrapped as playable WAV. Select PCM for models that require it, including current Gemini and HeyGen speech models. Match the sample rate to the provider's documented output; the PCM wrapper expects signed 16-bit mono data. This does not implement reference-audio/voice-cloning workflows required by some models.

## What was verified

- Desktop TypeScript check and 811 desktop tests pass.
- 11 native Rust tests pass, including local-only guards, provider capability filtering, current OpenCode endpoint selection, and PCM/WAV conversion.
- The Windows executable builds with the interface embedded; it does not depend on a development server.
- Public catalog requests through the packaged executable returned 30 STT and 38 TTS models on OpenRouter, and 80 OpenCode models. Counts are a snapshot and will change.
- The packaged local engine transcribed the synthetic fixture exactly: “The local speech engine is working. I like this kind of music.”
- The ivory/forest UI follows the Superdesign draft explicitly approved by the user. The prior browser review showed the implemented layout; current native UI interaction automation was denied access to Sonolect.

## Verification limits

No user API keys were supplied or read, and no paid STT, TTS, or rewriting requests were made. Keyed provider calls still require a real-account test in the app. Native credential round-trip and microphone/insertion interaction tests have not been completed. Do not interpret successful unit tests or public model discovery as proof of every model's billing, voice compatibility, or output quality.

This is a development build, not full Wispr Flow parity or a signed production release. Reliable automatic insertion into other applications, native cancellation, streaming, local semantic rewriting, local TTS, and broader platform support remain unfinished. Inherited dependency and release-hardening work also remains.

The November production-dependency audit of the full inherited monorepo reports 3 critical, 77 high, 39 moderate, and 14 low advisories. This includes packages outside the desktop speech path; no claim is made that all advisories are reachable in this executable. Dependency remediation is a release prerequisite. The report is retained locally as `studio-dependency-audit.json`.

## References

- [OpenRouter transcription](https://openrouter.ai/docs/guides/overview/multimodal/stt)
- [OpenRouter speech generation](https://openrouter.ai/docs/guides/overview/multimodal/tts)
- [OpenCode inference API](https://opencode.ai/v2/docs/console/api/inference/)
- [Approved Superdesign canvas](https://superdesign.dev/teams/2ffb3e67-4cfb-4b39-9346-e6d0d9b9e86e/projects/d5121030-4b10-4b90-a9c0-080b5d54f426)

Source remains in this working copy on `local-first-foundation`. Original audited repositories were preserved. Nothing was pushed or publicly deployed.
