import assert from "node:assert/strict";
import { it } from "node:test";

it("stopping during the permission request does not leave the microphone recording", async () => {
  let grant!: (value: MediaStream) => void;
  let stopped = false;
  Object.defineProperty(globalThis.navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: () => new Promise<MediaStream>(resolve => { grant = resolve; }),
  } });
  class Recorder {
    static isTypeSupported() { return true; }
    state = "inactive";
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; }
  }
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Recorder });
  const { useDesktopStore } = await import("./store/appStore");
  useDesktopStore.setState({ recordingState: "idle" });
  const starting = useDesktopStore.getState().startVoiceCapture();
  useDesktopStore.getState().stopVoiceCapture();
  grant({ getTracks: () => [{ stop: () => { stopped = true; } }] } as unknown as MediaStream);
  await starting;
  const state = useDesktopStore.getState().recordingState;
  useDesktopStore.getState().stopVoiceCapture();
  assert.notEqual(state, "recording");
  assert.equal(stopped, true);
});
