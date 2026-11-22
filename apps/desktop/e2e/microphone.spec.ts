import { expect, test, type Page } from "@playwright/test";

/** A navigation entry; its label may be followed by a description. */
function nav(page: Page, name: string) {
  return page.getByRole("navigation").getByRole("button", { name }).first();
}

test.describe("microphone choice", () => {
  test("lists the inputs, tests the level and remembers the choice", async ({
    page,
  }) => {
    await page.goto("/");
    await nav(page, "Settings").click();
    const card = page.locator("section", {
      has: page.getByRole("heading", { name: "Microphone", exact: true }),
    });
    const picker = card.getByLabel("Record with");
    await expect(picker).toHaveValue("");
    await expect(picker.locator("option").first()).toHaveText("System default");

    // The test asks for access, which is what makes the names available.
    const meter = card.getByRole("meter", { name: "Microphone level" });
    await expect(meter).toHaveAttribute("aria-valuenow", "0");
    await card.getByRole("button", { name: "Test microphone" }).click();
    await expect(card.getByText("Nothing is recorded.")).toBeVisible();
    // Chromium's synthetic microphone beeps: the meter has to move.
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")), {
        timeout: 10_000,
        intervals: [50],
      })
      .toBeGreaterThan(5);
    const named = picker.locator("option", { hasText: /Fake Audio Input 1/ });
    await expect(named).toHaveCount(1);

    const deviceId = await named.getAttribute("value");
    expect(deviceId).toBeTruthy();
    await picker.selectOption(deviceId!);
    // Changing the input ends the test that was listening to the old one.
    await expect(
      card.getByRole("button", { name: "Test microphone" }),
    ).toBeVisible();
    await expect(meter).toHaveAttribute("aria-valuenow", "0");

    // The chosen microphone is the one a test (and a dictation) opens.
    await page.evaluate(() => {
      const devices = navigator.mediaDevices;
      const original = devices.getUserMedia.bind(devices);
      const asked: unknown[] = [];
      (window as typeof window & { __asked?: unknown[] }).__asked = asked;
      devices.getUserMedia = (constraints) => {
        asked.push(constraints);
        return original(constraints);
      };
    });
    await card.getByRole("button", { name: "Test microphone" }).click();
    await expect(card.getByRole("button", { name: "Stop test" })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as typeof window & { __asked?: unknown[] }).__asked,
      ),
    ).toEqual([{ audio: { deviceId: { exact: deviceId } } }]);
    await card.getByRole("button", { name: "Stop test" }).click();

    await page.reload();
    await nav(page, "Settings").click();
    await expect(page.getByLabel("Record with")).toHaveValue(deviceId!);
  });

  test("says so when the chosen microphone is not connected", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem("sonolect.micDeviceId", "unplugged-device"),
    );
    await page.goto("/");
    await nav(page, "Settings").click();
    const picker = page.getByLabel("Record with");
    await expect(picker).toHaveValue("unplugged-device");
    await expect(picker.locator("option:checked")).toHaveText(
      "Chosen microphone (not connected)",
    );
    await expect(
      page.getByText("recordings use the system default"),
    ).toBeVisible();
    // The test still works: it falls back to the system default.
    await page.getByRole("button", { name: "Test microphone" }).click();
    await expect(
      page.getByText(
        "The chosen microphone is not connected, so the system default is used.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stop test" }).click();
  });

  test("opens the microphone once, and lets it go when the page closes", async ({
    page,
  }) => {
    // The microphone takes a moment to open, as a permission prompt does.
    await page.addInitScript(() => {
      const devices = navigator.mediaDevices;
      const original = devices.getUserMedia.bind(devices);
      const opened: MediaStream[] = [];
      (window as typeof window & { __opened?: MediaStream[] }).__opened =
        opened;
      devices.getUserMedia = async (constraints) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const stream = await original(constraints);
        opened.push(stream);
        return stream;
      };
    });
    const tracks = () =>
      page.evaluate(() =>
        (window as typeof window & { __opened?: MediaStream[] })
          .__opened!.flatMap((stream) => stream.getTracks())
          .map((track) => track.readyState),
      );
    await page.goto("/");
    await nav(page, "Settings").click();
    const card = page.locator("section", {
      has: page.getByRole("heading", { name: "Microphone", exact: true }),
    });

    // A second click while it opens does not open it again.
    await card.getByRole("button", { name: "Test microphone" }).dblclick();
    await expect(card.getByRole("button", { name: "Stop test" })).toBeVisible();
    expect(await tracks()).toEqual(["live"]);
    await card.getByRole("button", { name: "Stop test" }).click();
    expect(await tracks()).toEqual(["ended"]);

    // Leaving the page while it opens stops the microphone as soon as it is
    // open, rather than when the test would have ended by itself.
    await card.getByRole("button", { name: "Test microphone" }).click();
    await nav(page, "Overview").click();
    await expect.poll(async () => (await tracks()).length).toBe(2);
    await expect
      .poll(tracks, { timeout: 2_000, intervals: [50] })
      .toEqual(["ended", "ended"]);
  });

  test("the microphone settings are in French when the interface is", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem("sonolect.locale", "fr"),
    );
    await page.goto("/");
    await nav(page, "Réglages").click();
    await expect(page.getByLabel("Enregistrer avec")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tester le micro" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Enregistrer avec").locator("option").first(),
    ).toHaveText("Micro par défaut du système");
  });
});
