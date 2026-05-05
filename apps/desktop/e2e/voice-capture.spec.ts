import { expect, test, type Page } from "@playwright/test";

async function installMockVoiceCapture(page: Page) {
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

test.describe("Sonolect voice capture readiness", () => {
  test("records with mocked browser media, keeps captured bytes, and updates transcript in offline mode", async ({
    page,
  }) => {
    await installMockVoiceCapture(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("heading", { name: /Voice control/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/VITE_SONOLECT_API_URL not set/i),
    ).toBeVisible();
    await page.getByLabel("STT Language").selectOption("en");
    await page.getByRole("button", { name: "Cloud" }).click();
    await expect(page.getByText(/cloud-assisted/i).first()).toBeVisible();
    await page.getByRole("button", { exact: true, name: "Local" }).click();

    await page.getByRole("button", { name: "Home" }).click();
    await page.getByRole("button", { name: /Record now/i }).click();
    await expect(
      page.getByRole("status", { name: /Sonolect voice recorder/i }),
    ).toContainText(/0s|1s/);

    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (
              window as typeof window & {
                __sonolectE2eRecorderStarted?: boolean;
              }
            ).__sonolectE2eRecorderStarted,
          ),
        ),
      )
      .toBe(true);

    await page.getByRole("button", { name: "Stop" }).click();
    await expect(
      page.getByRole("status", { name: /Sonolect voice recorder/i }),
    ).toContainText("Done");
    await expect(page.getByText(/Recent capture/i)).toBeVisible();

    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (
              window as typeof window & {
                __sonolectE2eObjectUrlBytes?: number[];
              }
            ).__sonolectE2eObjectUrlBytes,
          ),
        ),
      )
      .toBe(true);

    const readiness = await page.evaluate(() => {
      const rawDraft = window.localStorage.getItem("sonolect.transcriptDraft");
      return {
        constraints: (
          window as typeof window & {
            __sonolectE2eMediaConstraints?: MediaStreamConstraints;
          }
        ).__sonolectE2eMediaConstraints,
        draft: rawDraft ? JSON.parse(rawDraft) : undefined,
        recorderBytes: (
          window as typeof window & { __sonolectE2eRecorderBytes?: number[] }
        ).__sonolectE2eRecorderBytes,
        objectUrlBytes: (
          window as typeof window & { __sonolectE2eObjectUrlBytes?: number[] }
        ).__sonolectE2eObjectUrlBytes,
        trackStopped: (
          window as typeof window & { __sonolectE2eTrackStopped?: boolean }
        ).__sonolectE2eTrackStopped,
      };
    });

    expect(readiness.constraints).toEqual({ audio: true });
    expect(readiness.draft?.transcript).toContain("audio/webm");
    expect(readiness.trackStopped).toBe(true);
    expect(readiness.recorderBytes?.slice(0, 12)).toEqual([
      82, 73, 70, 70, 52, 0, 0, 0, 87, 65, 86, 69,
    ]);
    expect(readiness.objectUrlBytes).toEqual(readiness.recorderBytes);
  });

  test("surfaces capture readiness errors when media APIs are unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: /Record now/i }).click();
    await expect(
      page.getByRole("status", { name: /Sonolect voice recorder/i }),
    ).toContainText("Error");
    await expect(page.getByText("error.micUnavailable")).toBeVisible();
  });

  test("applies Whisper command templates without persisting example home paths", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Settings" }).click();
    await page
      .getByRole("button", { name: "Use recommended command template" })
      .click();

    const savedWhisperConfig = await page.evaluate(() => {
      const raw = window.localStorage.getItem("sonolect.whisperConfig");
      return raw ? JSON.parse(raw) : undefined;
    });

    expect(savedWhisperConfig.command).toEqual([
      "whisper-cli",
      "--model",
      "{model}",
      "--file",
      "{audioPath}",
      "--output-json",
    ]);
    expect(savedWhisperConfig.modelName).toBe("base.en");
    expect(savedWhisperConfig.modelPath).toBe("");
    expect(JSON.stringify(savedWhisperConfig)).not.toContain("/home/you");
    expect(JSON.stringify(savedWhisperConfig)).not.toContain("/Users/you");
    expect(JSON.stringify(savedWhisperConfig)).not.toContain("C:/Users/you");
  });
});
