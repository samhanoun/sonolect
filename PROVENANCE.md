# Integrated local desktop foundation

This working copy starts from `samhanoun/sonolect` commit `cbdccb3e7815b6848de901f452af8046cb2e8008`.

The embedded inference implementation in `apps/desktop/src-tauri/src/local_engine.rs` adapts the Whisper context/state/inference and segment extraction approach from `sonolect/sonolect` commit `021a50bbeaab54bb9fdb1bbd9a8f06ee717a339d`, specifically `apps/desktop/src-tauri/src/whisper.rs`. It removes production stubs, uses a selected model path, caches the CPU context, accepts validated PCM WAV, and does not enable language-detection-only mode.

New integration code: explicit local/cloud processing policy, PCM adapter, local model download verification, native saved recordings, model/settings UI, regression tests, and the Windows build helper.

Model: `ggerganov/whisper.cpp`, `ggml-base.bin`, multilingual Whisper Base.
Source: https://huggingface.co/ggerganov/whisper.cpp
Verified size: 147951465 bytes.
SHA-256: `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`.
The checksum was read from the official Hugging Face model file metadata on 9 September 2026 and verified against the downloaded artifact. The binary is excluded from Git.

The two source snapshots retain their original licensing terms. This local integration does not relicense their code or grant redistribution rights. No repository push or public distribution was performed.
