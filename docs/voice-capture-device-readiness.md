# Voice capture device-readiness E2E checklist

This checklist complements the Playwright suite that CI runs in `apps/desktop/e2e`. The suite runs the Studio with a stand-in for the app's native side and Chromium's synthetic microphone. It checks recording, live text, saved recordings and error messages without microphone hardware. It also checks that the browser preview refuses to record. On a machine that cannot use port 5174 or Playwright's own Chromium, set `SONOLECT_E2E_PORT` and `SONOLECT_E2E_CHROMIUM` before `pnpm --filter @sonolect/desktop e2e`.

Use this manual pass for real microphones, system permission prompts and mobile devices.

## Desktop hardware pass

Run this pass in the desktop app, not in the browser preview. Only the app records and transcribes.

Prerequisites:

- Start the app from the repository with `pnpm --filter @sonolect/desktop tauri dev`, or install a build from CI ([release.md](release.md)).
- For local speech, open Settings and select `Install local model` under Local Whisper, or enter the path of a Whisper `.bin` file you already have.

Steps:

1. Open Transcribe. Set Processing mode to `Local only`. Under Recognition, pick `English` or one other language.
2. Open Settings › Microphone. Pick the input, select `Test microphone` and check that the level moves with your voice. The test records nothing.
3. Open Transcribe and select `Record to add text`. Accept the system's microphone prompt if one appears. Check that the dock says `Listening…` and that its clock runs.
4. Speak a fixed phrase such as `Sonolect hardware readiness test, one two three.`
5. Select `Stop`. Check that the dock goes through `Processing…` to `Your words are ready` and that the phrase appears in the editor. Check that the system's microphone indicator turns off.
6. Open Library. Check that the recording is listed and plays back.
7. Use the keyboard. Press `Ctrl+Shift+M` (`Cmd+Shift+M` on macOS) once to start and again to stop. Hold `Ctrl+Shift+V` (`Cmd+Shift+V` on macOS) to talk and release it to stop.
8. Select `Dismiss` on the dock and check that a second recording starts.
9. Turn off microphone access for the app in the system privacy settings, then start a recording. Check that the dock shows `Recording needs attention` with a reason, instead of failing silently.

## Browser preview

`pnpm --filter @sonolect/desktop dev` serves the same Studio in a browser, at `http://localhost:5173` by default. It is a developer tool. It is not shipped or hosted, and it has no speech engine:

- Starting a dictation, from a button or a key, shows `The browser preview cannot transcribe speech.` in the dock. The microphone does not open and nothing is sent.
- Importing an audio file shows `The browser preview cannot transcribe audio files.` The file is not read and nothing is sent.
- The Transcribe page says that it is the browser preview. Typing, editing and exporting text work there.

One developer setup does transcribe, through a Sonolect API:

1. Start Vite with `VITE_SONOLECT_API_URL=http://127.0.0.1:<api-port>`.
2. Set Processing mode to `Cloud enabled` and keep `Local Whisper` as the speech model. The Transcribe page then no longer shows the browser preview notice.
3. Record. On Stop, the preview sends the audio to `POST /v1/transcribe` on that API and the text to `POST /v1/polish`. If `/v1/transcribe` fails or returns no text, it falls back to `POST /audio/jobs` and `POST /audio/jobs/{id}/audio`. The API has those two routes only outside production (`NODE_ENV=development`) or with `SONOLECT_API_PREVIEW_ROUTES=1`; see [api.md](api.md#what-production-serves).

With an online speech model, or in `Local only`, the preview refuses before it records, as above. If Processing mode changes to `Local only` while a recording runs, the preview drops that recording and says so.

To check a microphone in the preview, use Settings › Microphone › `Test microphone`. It shows the level and records nothing. It works even while the dock still shows the refusal.

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
