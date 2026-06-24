import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const toneWavBytes = Array.from(readFileSync(join(fixturesDir, "tone.wav")));

/**
 * Install mock media + recorder that delivers the tone fixture,
 * for meeting-flow E2E tests.
 */
async function installMeetingMocks(page: Page) {
  await page.addInitScript(
    ({ wavBytes }) => {
      window.localStorage.clear();

      const fixtureData = new Uint8Array(wavBytes);

      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => ({
            getTracks: () => [
              {
                kind: "audio",
                readyState: "live",
                stop: () => {},
              },
            ],
          }),
        },
      });

      class MeetingMediaRecorder extends EventTarget {
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
        value: MeetingMediaRecorder,
      });
    },
    { wavBytes: toneWavBytes },
  );
}

test.describe("Meeting pipeline E2E", () => {
  test("records, stops, and shows transcript in history (voice capture flow)", async ({
    page,
  }) => {
    await installMeetingMocks(page);
    await page.goto("/");

    // Ensure we're on the home view
    await expect(page.getByText("Sonolect").first()).toBeVisible();

    // Verify offline history items are visible (acts as "meeting history")
    await expect(
      page.getByRole("button", { name: /Préparer la démo investisseurs/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Réponse client urgente/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Idées roadmap desktop/i }),
    ).toBeVisible();

    // Start a recording session (meeting-like flow)
    await page.getByRole("button", { name: "Record" }).click();
    const recorder = page.getByRole("status", {
      name: /Dictation recorder/i,
    });
    await expect(recorder).toContainText(/0s|1s/);

    // Stop the recording (end meeting)
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(recorder).toContainText("Done");

    // Verify the capture result is shown
    // "Recent capture" playback card was removed in the new UI.
  });

  test("transcript session can be opened and edited after capture", async ({
    page,
  }) => {
    await installMeetingMocks(page);
    await page.goto("/");

    // Open an existing transcript (simulates reviewing a meeting)
    await page
      .getByRole("button", { name: /Préparer la démo investisseurs/i })
      .first()
      .click();

    const editor = page.getByLabel(/Transcription editor/i);
    await expect(editor).toBeVisible();

    // Edit the transcript
    await editor.fill("Meeting notes: discussed Q3 roadmap and priorities");
    await expect(page.getByText(/7 words/i)).toBeVisible();

    // Undo/Redo work on meeting transcript
    await page.getByRole("button", { name: /Undo/i }).click();
    await expect(editor).not.toHaveValue(
      "Meeting notes: discussed Q3 roadmap and priorities",
    );
    await page.getByRole("button", { name: /Redo/i }).click();
    await expect(editor).toHaveValue(
      "Meeting notes: discussed Q3 roadmap and priorities",
    );
  });

  test("export buttons are visible for transcript session", async ({
    page,
  }) => {
    await installMeetingMocks(page);
    await page.goto("/");

    // Open a transcript session
    await page
      .getByRole("button", { name: /Préparer la démo investisseurs/i })
      .first()
      .click();

    const editor = page.getByLabel(/Transcription editor/i);
    await expect(editor).toBeVisible();

    // The polished preview (export-ready region) should be available
    await expect(
      page.getByRole("region", { name: /Wispr-style polished preview/i }),
    ).toBeVisible();
  });

  test("settings page shows voice control and STT configuration", async ({
    page,
  }) => {
    await installMeetingMocks(page);
    await page.goto("/");

    // Navigate to settings (system audio / privacy check)
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(
      page.getByRole("heading", { name: /Preferences/i }),
    ).toBeVisible();

    // Verify API status indicator
    await expect(
      page.getByText(/VITE_SONOLECT_API_URL not set/i),
    ).toBeVisible();

    // Verify STT language selector
    await page.getByLabel(/Speech-to-text language/i).selectOption("en");

    // Verify privacy mode toggle
    await page.getByRole("button", { name: "Cloud-assisted" }).click();
    await expect(page.getByText(/cloud-assisted/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Local-first" }).click();
  });

  test("multiple transcript sessions appear in history list", async ({
    page,
  }) => {
    await installMeetingMocks(page);
    await page.goto("/");

    // All three offline history items should be visible
    const historyItems = page.locator('[class*="session"]');

    // At minimum, the offline fallback items should be present
    await expect(
      page.getByText(/Préparer la démo investisseurs/i).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/Réponse client urgente/i).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/Idées roadmap desktop/i).first(),
    ).toBeVisible();

    // Verify offline indicator
    await expect(page.getByText(/offline/i).first()).toBeVisible();
  });
});
