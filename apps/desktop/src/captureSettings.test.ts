import assert from "node:assert/strict";
import { it } from "node:test";

const globals = globalThis as unknown as Record<string, unknown>;

class Recorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  }
}

it("the browser preview refuses before it opens the microphone, from every entry point", async () => {
  let opened = 0;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        opened += 1;
        throw new Error("the microphone must not open");
      },
    },
  });
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: Recorder,
  });
  const { useDesktopStore } = await import("./store/appStore");
  // No Tauri here, and unit tests have no Sonolect API URL: in either mode
  // the preview cannot transcribe.
  for (const privacyLevel of ["local", "cloud"] as const) {
    for (const source of ["app", "bubble", "hotkey"] as const) {
      useDesktopStore.setState({
        privacyLevel,
        recordingState: "idle",
        voiceError: undefined,
      });
      await useDesktopStore.getState().startVoiceCapture(source);
      const state = useDesktopStore.getState();
      assert.equal(state.recordingState, "error", `${privacyLevel} ${source}`);
      assert.equal(state.voiceError, "voice.previewCannotTranscribe");
      assert.equal(state.dictationSource, source);
    }
  }
  assert.equal(opened, 0);
  useDesktopStore.setState({ privacyLevel: "local", recordingState: "idle" });
});

it("stopping during the permission request does not leave the microphone recording", async () => {
  // In the app: the browser preview never asks for the microphone here.
  globals.window = { __TAURI_INTERNALS__: {} };
  try {
    let grant!: (value: MediaStream) => void;
    let stopped = false;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            grant = resolve;
          }),
      },
    });
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: Recorder,
    });
    const { useDesktopStore } = await import("./store/appStore");
    useDesktopStore.setState({ recordingState: "idle" });
    const starting = useDesktopStore.getState().startVoiceCapture();
    useDesktopStore.getState().stopVoiceCapture();
    grant({
      getTracks: () => [
        {
          stop: () => {
            stopped = true;
          },
        },
      ],
    } as unknown as MediaStream);
    await starting;
    const state = useDesktopStore.getState().recordingState;
    useDesktopStore.getState().stopVoiceCapture();
    assert.notEqual(state, "recording");
    assert.equal(stopped, true);
  } finally {
    delete globals.window;
  }
});
