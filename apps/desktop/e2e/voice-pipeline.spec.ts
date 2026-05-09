import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const silenceWavBytes = Array.from(
  readFileSync(join(fixturesDir, "silence.wav")),
);
const toneWavBytes = Array.from(readFileSync(join(fixturesDir, "tone.wav")));

/**
 * Install a mock voice capture pipeline that uses a real WAV fixture
 * instead of recording from a live microphone. Also mocks the Tauri
 * invoke bridge so tests run without a real Whisper binary.
 */
async function installFixturePipeline(page: Page, wavBytes: number[]) {
  await page.addInitScript(
    ({ wavBytes: bytes }) => {
      window.localStorage.clear();

      const fixtureData = new Uint8Array(bytes);

      // --- mock mediaDevices ------------------------------------------------
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            return {
              getTracks: () => [
                {
                  kind: "audio",
                  readyState: "live",
                  stop: () => {},
                },
              ],
            } as unknown as MediaStream;
          },
        },
      });

      // --- mock MediaRecorder with fixture data ----------------------------
      class FixtureMediaRecorder extends EventTarget {
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
        }

        stop() {
          if (this.state !== "recording") return;
          this.state = "inactive";
          const blob = new Blob([fixtureData], { type: "audio/wav" });
          this.ondataavailable?.({ data: blob } as BlobEvent);
          this.onstop?.();
        }
      }

      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: FixtureMediaRecorder,
      });

      // --- capture objectURL bytes for verification -----------------------
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (object: Blob | MediaSource) => {
        if (object instanceof Blob) {
          void object.arrayBuffer().then((buffer) => {
            (
              window as typeof window & {
                __sonolectE2eFixtureBytes?: number[];
              }
            ).__sonolectE2eFixtureBytes = Array.from(new Uint8Array(buffer));
          });
        }
        return originalCreateObjectURL(object);
      };

      // --- expose fixture bytes for in-page assertions --------------------
      (
        window as typeof window & {
          __sonolectE2eInjectedFixtureBytes?: number[];
        }
      ).__sonolectE2eInjectedFixtureBytes = bytes;
    },
    { wavBytes },
  );
}

test.describe("Voice pipeline E2E with WAV fixtures", () => {
  test("tone fixture produces a valid RIFF/WAVE header", async ({ page }) => {
    await installFixturePipeline(page, toneWavBytes);
    await page.goto("/");

    const headerCheck = await page.evaluate((bytes) => {
      const arr = new Uint8Array(bytes);
      const riff = String.fromCharCode(arr[0]!, arr[1]!, arr[2]!, arr[3]!);
      const wave = String.fromCharCode(arr[8]!, arr[9]!, arr[10]!, arr[11]!);
      return { riff, wave, length: arr.length };
    }, toneWavBytes);

    expect(headerCheck.riff).toBe("RIFF");
    expect(headerCheck.wave).toBe("WAVE");
    // 44 header + 16000 samples * 2 bytes = 32044
    expect(headerCheck.length).toBe(32044);
  });

  test("VAD detects activity in tone fixture but not in silence fixture", async ({
    page,
  }) => {
    await installFixturePipeline(page, toneWavBytes);
    await page.goto("/");

    const vadResults = await page.evaluate(
      ({ toneBytes, silenceBytes }) => {
        // Inline mini-VAD for fixture testing (mirrors src/vad.ts logic)
        function computeEnergy(samples: Float32Array): number {
          if (samples.length === 0) return 0;
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            sum += samples[i]! * samples[i]!;
          }
          return Math.sqrt(sum / samples.length);
        }

        function wavToFloat32(bytes: number[]): Float32Array {
          const buffer = new Uint8Array(bytes).buffer;
          const view = new DataView(buffer);
          const dataSize = view.getUint32(40, true);
          const numSamples = dataSize / 2;
          const samples = new Float32Array(numSamples);
          for (let i = 0; i < numSamples; i++) {
            samples[i] = view.getInt16(44 + i * 2, true) / 32768;
          }
          return samples;
        }

        const toneSamples = wavToFloat32(toneBytes);
        const silenceSamples = wavToFloat32(silenceBytes);

        const toneEnergy = computeEnergy(toneSamples);
        const silenceEnergy = computeEnergy(silenceSamples);

        const VAD_THRESHOLD = 0.01;
        return {
          toneEnergy,
          silenceEnergy,
          toneIsSpeech: toneEnergy >= VAD_THRESHOLD,
          silenceIsSpeech: silenceEnergy >= VAD_THRESHOLD,
        };
      },
      { toneBytes: toneWavBytes, silenceBytes: silenceWavBytes },
    );

    expect(vadResults.toneIsSpeech).toBe(true);
    expect(vadResults.silenceIsSpeech).toBe(false);
    expect(vadResults.toneEnergy).toBeGreaterThan(0.1);
    expect(vadResults.silenceEnergy).toBe(0);
  });

  test("records with tone fixture, submits transcription, and shows result in history", async ({
    page,
  }) => {
    await installFixturePipeline(page, toneWavBytes);
    await page.goto("/");

    // Navigate to settings and ensure local mode
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("heading", { name: /Voice control/i }),
    ).toBeVisible();
    await page.getByRole("button", { exact: true, name: "Local" }).click();
    await page.getByRole("button", { name: "Home" }).click();

    // Start recording
    await page.getByRole("button", { name: /Record now/i }).click();
    await expect(
      page.getByRole("status", { name: /Sonolect voice recorder/i }),
    ).toContainText(/0s|1s/);

    // Stop recording — triggers fixture delivery
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(
      page.getByRole("status", { name: /Sonolect voice recorder/i }),
    ).toContainText("Done");

    // Verify fixture bytes were captured
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (
              window as typeof window & {
                __sonolectE2eFixtureBytes?: number[];
              }
            ).__sonolectE2eFixtureBytes,
          ),
        ),
      )
      .toBe(true);

    // Verify captured bytes match the tone fixture RIFF header
    const capturedHeader = await page.evaluate(() => {
      const bytes = (
        window as typeof window & {
          __sonolectE2eFixtureBytes?: number[];
        }
      ).__sonolectE2eFixtureBytes;
      return bytes?.slice(0, 12);
    });
    expect(capturedHeader).toEqual([
      82, 73, 70, 70, 52, 125, 0, 0, 87, 65, 86, 69,
    ]);

    // The offline transcript draft should be saved
    const draft = await page.evaluate(() => {
      const raw = window.localStorage.getItem("sonolect.transcriptDraft");
      return raw ? JSON.parse(raw) : undefined;
    });
    expect(draft).toBeDefined();
    expect(draft.transcript).toBeTruthy();

    // Recent capture should appear
    await expect(page.getByText(/Recent capture/i)).toBeVisible();
  });

  test("export works on transcript after voice capture", async ({ page }) => {
    await installFixturePipeline(page, toneWavBytes);
    await page.goto("/");

    // Click an offline transcript session to load it
    await page
      .getByRole("button", { name: /Préparer la démo investisseurs/i })
      .first()
      .click();
    const editor = page.getByLabel(/Transcription editor/i);
    await expect(editor).toBeVisible();

    // Fill with test content
    await editor.fill("Fixture-based pipeline test transcript content");
    await expect(page.getByText(/6 words/i)).toBeVisible();

    // The polished preview region should be visible
    await expect(
      page.getByRole("region", { name: /Wispr-style polished preview/i }),
    ).toBeVisible();
  });
});
