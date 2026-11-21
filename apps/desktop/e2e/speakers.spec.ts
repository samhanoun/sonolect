import { expect, test, type Page } from "@playwright/test";
import {
  installMockTauri,
  nativeCalls,
  releaseNative,
  type MockCapture,
  type MockSpeakerTurn,
} from "./support/mockTauri";

/** A navigation entry; its label may be followed by a description. */
function nav(page: Page, name: string) {
  return page.getByRole("navigation").getByRole("button", { name }).first();
}

const detectButton = (page: Page) =>
  page.getByRole("button", { name: "Detect speakers", exact: true });
const speakerCount = (page: Page) =>
  page.getByRole("combobox", { name: "Speakers", exact: true });
const status = (page: Page) => page.locator(".studio-segments-status");
const legend = (page: Page) =>
  page.getByRole("list", { name: "Speakers in this transcript" });

/** What the fields found by `label` hold, in order. */
const values = (page: Page, label: RegExp) =>
  page
    .getByLabel(label)
    .evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );
/** The speaker of every segment, in order. */
const speakers = (page: Page) => values(page, /^Speaker of segment \d+$/);

/** An interview of four sentences; the guest's last answer is named. */
const interview: MockCapture = {
  id: "1700000000000-7",
  createdAtMs: Date.UTC(2026, 10, 19, 9, 30),
  durationMs: 8000,
  transcript:
    "Welcome to the show.\n\nThanks for having me.\n\nHow did it start?\n\nWith a small idea.",
  error: null,
  language: "en",
  segments: [
    { startMs: 0, endMs: 2000, text: "Welcome to the show." },
    { startMs: 2000, endMs: 4000, text: "Thanks for having me." },
    { startMs: 4000, endMs: 6000, text: "How did it start?" },
    { startMs: 6000, endMs: 8000, text: "With a small idea.", speaker: "Ana" },
  ],
};

/** The host asks and the guest answers, as the detection hears it. */
const hostAndGuest: MockSpeakerTurn[] = [
  { startMs: 0, endMs: 1900, speaker: 1 },
  { startMs: 2100, endMs: 3900, speaker: 2 },
  { startMs: 4100, endMs: 5900, speaker: 1 },
  { startMs: 6100, endMs: 8000, speaker: 2 },
];

async function openInterview(page: Page) {
  await nav(page, "Library").click();
  await page.getByRole("button", { name: /^Open editor/ }).click();
  await page.getByRole("button", { name: "Segments", exact: true }).click();
}

/** Typed text, seen as segments: it has no recording behind it. */
async function typeText(page: Page) {
  await nav(page, "Transcribe").click();
  await page.getByLabel("Transcript editor").fill("First point. Second point.");
  await page.getByRole("button", { name: "Segments", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Transcript segments" }),
  ).toBeVisible();
}

test.describe("speaker detection", () => {
  test("is offered only for a saved recording in the desktop app", async ({
    page,
    context,
  }) => {
    // The browser preview cannot detect speakers.
    await page.goto("/");
    await typeText(page);
    await expect(detectButton(page)).toHaveCount(0);
    await expect(speakerCount(page)).toHaveCount(0);

    // The desktop app can, but only in a transcript of one recording.
    const desktop = await context.newPage();
    await installMockTauri(desktop, [interview]);
    await desktop.goto("/");
    await typeText(desktop);
    await expect(detectButton(desktop)).toHaveCount(0);
    await openInterview(desktop);
    await expect(detectButton(desktop)).toBeEnabled();
    await expect(speakerCount(desktop)).toHaveValue("");
    expect(await nativeCalls(desktop, "speaker_model_status")).toEqual([]);
  });

  test("asks before downloading, keeps typed names, and renames everywhere in one undo step", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installMockTauri(page, [interview], {
      speakerModel: false,
      speakerTurns: { [interview.id]: hostAndGuest },
      hold: ["download_speaker_model", "detect_speakers"],
    });
    await page.goto("/");
    await openInterview(page);
    await expect.poll(() => speakers(page)).toEqual(["", "", "", "Ana"]);

    await detectButton(page).click();
    await expect(status(page)).toContainText(
      "Download the 28 MB speaker model? Your audio stays on this device.",
    );
    await page.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(status(page)).not.toContainText("speaker model");
    expect(await nativeCalls(page, "download_speaker_model")).toEqual([]);

    await detectButton(page).click();
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await expect(status(page)).toContainText(
      "Downloading the speaker model… 50%",
    );
    await expect(detectButton(page)).toBeDisabled();
    await releaseNative(page, "download_speaker_model");

    // Ana was typed, so the question comes before anything changes.
    await expect(status(page)).toContainText(
      "Some segments already have names. Keep them or replace them?",
    );
    expect(await nativeCalls(page, "detect_speakers")).toEqual([]);
    await page.getByRole("button", { name: "Keep names", exact: true }).click();
    await expect(status(page)).toContainText("Detecting speakers… 40%");
    await releaseNative(page, "detect_speakers");
    await expect(status(page)).toHaveText("2 speakers found.");
    expect(await nativeCalls(page, "detect_speakers")).toEqual([
      {
        command: "detect_speakers",
        args: { id: interview.id, speakers: null },
      },
    ]);
    // The guest is called Ana everywhere; the host gets a number.
    await expect
      .poll(() => speakers(page))
      .toEqual(["Speaker 1", "Ana", "Speaker 1", "Ana"]);
    await expect(legend(page).getByRole("listitem")).toHaveText([
      "2 segments",
      "2 segments",
    ]);
    await expect
      .poll(() => values(page, /^Rename .+ everywhere$/))
      .toEqual(["Speaker 1", "Ana"]);

    const rename = legend(page).getByLabel("Rename Speaker 1 everywhere", {
      exact: true,
    });
    await rename.fill("Ben");
    await rename.press("Enter");
    await expect
      .poll(() => speakers(page))
      .toEqual(["Ben", "Ana", "Ben", "Ana"]);
    await expect(
      legend(page).getByLabel("Rename Ben everywhere", { exact: true }),
    ).toHaveValue("Ben");

    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await undo.click();
    await expect
      .poll(() => speakers(page))
      .toEqual(["Speaker 1", "Ana", "Speaker 1", "Ana"]);
    await undo.click();
    await expect.poll(() => speakers(page)).toEqual(["", "", "", "Ana"]);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect
      .poll(() => speakers(page))
      .toEqual(["Speaker 1", "Ana", "Speaker 1", "Ana"]);

    // The names are saved with the recording.
    await page.getByRole("button", { name: "Save to library" }).click();
    await expect(page.getByText("Saved to your library.")).toBeVisible();
    const [saved] = await nativeCalls(page, "update_local_capture");
    expect(
      (saved?.args as { segments: { speaker?: string }[] }).segments.map(
        (segment) => segment.speaker,
      ),
    ).toEqual(["Speaker 1", "Ana", "Speaker 1", "Ana"]);
    expect(errors).toEqual([]);
  });

  test("a running detection can be cancelled, and typed names can be replaced", async ({
    page,
  }) => {
    await installMockTauri(page, [interview], {
      speakerTurns: { [interview.id]: hostAndGuest },
      hold: ["detect_speakers"],
    });
    await page.goto("/");
    await openInterview(page);
    await speakerCount(page).selectOption("2");

    await detectButton(page).click();
    await page
      .getByRole("button", { name: "Replace names", exact: true })
      .click();
    await expect(status(page)).toContainText("Detecting speakers… 40%");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(status(page)).toHaveText("Speaker detection was cancelled.");
    expect(await nativeCalls(page, "cancel_speaker_detection")).toHaveLength(1);
    await expect.poll(() => speakers(page)).toEqual(["", "", "", "Ana"]);
    await expect(detectButton(page)).toBeEnabled();

    await detectButton(page).click();
    await page
      .getByRole("button", { name: "Replace names", exact: true })
      .click();
    await releaseNative(page, "detect_speakers");
    await expect(status(page)).toHaveText("2 speakers found.");
    await expect
      .poll(() => speakers(page))
      .toEqual(["Speaker 1", "Speaker 2", "Speaker 1", "Speaker 2"]);
    expect(
      (await nativeCalls(page, "detect_speakers")).map((call) => call.args),
    ).toEqual([
      { id: interview.id, speakers: 2 },
      { id: interview.id, speakers: 2 },
    ]);
  });

  test("the speaker model can be downloaded from Settings", async ({
    page,
  }) => {
    await installMockTauri(page, [], { speakerModel: false });
    await page.goto("/");
    await nav(page, "Settings").click();
    await expect(
      page.getByRole("heading", { name: "Speaker model" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Download it once to detect who speaks in a recording. Your audio stays on this device.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Speaker detection · CPU · 28 MB"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Download speaker model", exact: true })
      .click();
    await expect(
      page.getByText("Speaker model downloaded and checksum verified."),
    ).toBeVisible();
    await expect(
      page.getByText("The speaker model is on this computer."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reinstall speaker model" }),
    ).toBeEnabled();
  });
});
