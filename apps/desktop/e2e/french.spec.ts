import { expect, test, type Page } from "@playwright/test";

const FRENCH_PAGES: Array<[string, RegExp]> = [
  ["Vue d'ensemble", /Faites de la place à vos idées/],
  ["Transcrire", /Trouvez votre rythme/],
  ["Synthèse vocale", /Donnez une voix à vos écrits/],
  ["Bibliothèque", /Votre bibliothèque vocale/],
  ["Dictionnaire", /Vos mots, bien orthographiés/],
  ["Extraits", /Dites-en moins, écrivez-en plus/],
  ["Modèles et voix", /Vos modèles, votre choix/],
  ["Réglages", /Faites comme chez vous/],
];

// English sentences that must not survive on any page once French is active.
const ENGLISH_LEFTOVERS =
  /\b(Settings|Library|Recordings?|Transcript|Delete|Download|Language|Provider|Local only|Cloud enabled|Your |Choose |Save |Search)\b/;

function nav(page: Page, name: string) {
  return page
    .getByRole("navigation")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
}

async function visibleText(page: Page) {
  return page.evaluate(() => {
    const parts: string[] = [document.body.innerText];
    for (const element of document.querySelectorAll<HTMLElement>(
      "[aria-label], [placeholder], [title]",
    )) {
      for (const attribute of ["aria-label", "placeholder", "title"]) {
        const value = element.getAttribute(attribute);
        if (value) parts.push(value);
      }
    }
    for (const option of document.querySelectorAll("option")) {
      // Language pickers list each language under its own name.
      if (!option.lang) parts.push(option.textContent ?? "");
    }
    return parts.join("\n");
  });
}

test.describe("French interface", () => {
  test("switching the interface language translates every page", async ({
    page,
  }) => {
    await page.goto("/");
    await nav(page, "Settings").click();
    await page.getByLabel("Interface language").selectOption("fr");

    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByLabel("Langue de l'interface")).toHaveValue("fr");

    for (const [name, heading] of FRENCH_PAGES) {
      await nav(page, name).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      const text = await visibleText(page);
      // Dictation languages keep their English-free native names, and brand
      // names stay as they are, so only whole English UI words are flagged.
      expect(
        text.match(ENGLISH_LEFTOVERS)?.[0] ?? null,
        `English text left on "${name}"`,
      ).toBeNull();
    }
  });

  test("the chosen language survives a reload", async ({ page }) => {
    await page.goto("/");
    await nav(page, "Settings").click();
    await page.getByLabel("Interface language").selectOption("fr");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Faites de la place à vos idées/,
    );
    await nav(page, "Réglages").click();
    await page.getByLabel("Langue de l'interface").selectOption("en");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Make room for your thoughts/,
    );
  });

  test("quick navigation and the transcript editor work in French", async ({
    page,
  }) => {
    await page.goto("/");
    await nav(page, "Settings").click();
    await page.getByLabel("Interface language").selectOption("fr");

    await page.keyboard.press("Control+k");
    const finder = page.getByLabel("Trouver une page");
    await finder.fill("biblio");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Votre bibliothèque vocale/,
    );

    await nav(page, "Transcrire").click();
    const editor = page.getByLabel("Éditeur de transcription");
    await editor.fill("bonjour");
    await expect(page.getByText("1 mot", { exact: true })).toBeVisible();
    await editor.fill("bonjour tout le monde");
    await expect(page.getByText("4 mots", { exact: true })).toBeVisible();
  });
});

test.describe("French system language", () => {
  test.use({ locale: "fr-FR" });

  test("the studio opens in French on a French system", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Faites de la place à vos idées/,
    );
    await expect(nav(page, "Bibliothèque")).toBeVisible();
  });
});
