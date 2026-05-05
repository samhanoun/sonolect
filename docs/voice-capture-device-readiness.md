# Voice capture device-readiness E2E checklist

This checklist complements CI Playwright coverage that mocks browser media APIs. CI proves the app can request audio, drive `MediaRecorder`, keep real Blob bytes, append the capture to the transcript editor, and surface unsupported-device errors without requiring microphone hardware.

Use this manual harness for real microphones, OS permission prompts, and mobile devices.

## Desktop hardware pass

Prerequisites:

- Run from `apps/desktop` with a local browser-capable desktop: `pnpm dev --host 127.0.0.1 --port 5174 --strictPort`.
- Optional local API: set `VITE_SONOLECT_API_URL=http://127.0.0.1:<api-port>` before launching Vite if you want backend audio-job upload coverage.
- Optional desktop Whisper: configure `SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS` and verify the model path in Settings.

Steps:

1. Open `http://127.0.0.1:5174` in Chrome and confirm the top bar shows either `offline` or `API ready` according to your environment.
2. Open Settings.
   - Toggle Local and Cloud privacy modes.
   - Select `English` and one non-English STT language.
   - If testing Whisper, enter model path/name/command args, save, and validate the status text.
3. Click `Record now`.
   - Accept the OS/browser microphone permission prompt.
   - Confirm the recorder pill appears, waveform animates, and elapsed time increments.
4. Speak a deterministic phrase such as: `Sonolect hardware readiness test, one two three.`
5. Click `Stop`.
   - Confirm the recorder transitions through processing and lands on `Done`.
   - Confirm the mic indicator disappears and the OS/browser privacy indicator turns off.
   - Confirm the recent capture audio player appears and plays audible audio.
6. Confirm transcript behavior:
   - Offline/no Whisper: transcript editor receives an audio metadata marker with duration, MIME type, and size.
   - Local API: network/devtools show `POST /audio/jobs` followed by `POST /audio/jobs/{id}/audio` with the captured audio MIME type.
   - Desktop Whisper: deterministic phrase text appears with timestamped segments.
7. Use keyboard capture controls:
   - Press `Cmd/Ctrl+Shift+M` once to start and again to stop.
   - Hold `Cmd/Ctrl+Shift+V` to push-to-talk and release to stop.
8. Click the recorder close/reset button and verify a second capture can be started.
9. Revoke microphone permission in the browser/site settings, reload, and verify `Record now` surfaces a clear recorder error rather than silently failing.

## Mobile device pass

Prerequisites:

- Use a physical iOS Safari and Android Chrome device when possible; simulators often do not exercise real mic routing.
- Serve the app/API over a trusted origin (`https` or localhost tunnel) because mobile browsers require a secure context for microphone capture.

Steps:

1. Open the app on the device and confirm onboarding/settings are reachable.
2. Toggle privacy mode and select STT language.
3. Start a capture, accept the platform microphone permission, speak the deterministic phrase, and stop.
4. Confirm playback uses the device speaker/Bluetooth route expected for the test.
5. Confirm app behavior for:
   - Initial permission grant.
   - Permission denied.
   - Permission revoked after one successful capture.
   - Screen lock/backgrounding during recording.
   - Bluetooth headset connected/disconnected before capture.
6. If API/Whisper is enabled, verify the job/transcript result matches the spoken phrase closely enough for release acceptance.

## Release evidence to collect

- Browser/device/OS versions.
- Microphone route: built-in, USB, Bluetooth, or headset.
- Whether API and/or Whisper were enabled.
- Screenshot or screen recording of recorder states: permission, recording, processing, done/error.
- For API runs: request IDs/job IDs and audio MIME type/size.
- For transcription runs: expected phrase and observed transcript.
