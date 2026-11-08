import type { Page } from "@playwright/test";

/** Replaces getUserMedia and MediaRecorder with a deterministic WAV fixture. */
export async function installMockVoiceCapture(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();

    const fixtureBytes = new Uint8Array([
      82, 73, 70, 70, 52, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0,
      0, 1, 0, 1, 0, 128, 62, 0, 0, 0, 125, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97,
      16, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          (
            window as typeof window & {
              __sonolectE2eMediaConstraints?: MediaStreamConstraints;
            }
          ).__sonolectE2eMediaConstraints = constraints;
          return {
            getTracks: () => [
              {
                kind: "audio",
                readyState: "live",
                stop: () => {
                  (
                    window as typeof window & {
                      __sonolectE2eTrackStopped?: boolean;
                    }
                  ).__sonolectE2eTrackStopped = true;
                },
              },
            ],
          } as unknown as MediaStream;
        },
      },
    });

    class MockMediaRecorder extends EventTarget {
      static isTypeSupported(mimeType: string) {
        return mimeType.startsWith("audio/");
      }

      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      state: RecordingState = "inactive";

      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        super();
        this.mimeType = options?.mimeType || "audio/wav";
      }

      start() {
        this.state = "recording";
        (
          window as typeof window & { __sonolectE2eRecorderStarted?: boolean }
        ).__sonolectE2eRecorderStarted = true;
      }

      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        const blob = new Blob([fixtureBytes], {
          type: this.mimeType || "audio/wav",
        });
        (
          window as typeof window & { __sonolectE2eRecorderBytes?: number[] }
        ).__sonolectE2eRecorderBytes = Array.from(fixtureBytes);
        this.ondataavailable?.({ data: blob } as BlobEvent);
        this.onstop?.();
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: MockMediaRecorder,
    });

    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) {
        void object.arrayBuffer().then((buffer) => {
          (
            window as typeof window & { __sonolectE2eObjectUrlBytes?: number[] }
          ).__sonolectE2eObjectUrlBytes = Array.from(new Uint8Array(buffer));
        });
      }
      return originalCreateObjectURL(object);
    };
  });
}
