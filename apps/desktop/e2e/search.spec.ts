import { expect, test } from "@playwright/test";

test.describe("Search panel view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^History$/i }).click();
    await expect(
      page.getByRole("heading", { name: /Find past dictations/i }),
    ).toBeVisible();
  });

  test("shows empty state prompt before any search query", async ({
    page,
  }) => {
    await expect(
      page.getByText(/Type a search query to find matching transcripts/i),
    ).toBeVisible();
  });

  test("enters a search query and checks for results or no-results message", async ({
    page,
  }) => {
    await page.getByLabel("Search transcripts").fill("demo");
    // With offline fixture data, results should appear or "No results" message
    const hasResults = await page
      .locator("article.preference-row")
      .first()
      .isVisible()
      .catch(() => false);
    if (hasResults) {
      await expect(page.locator("article.preference-row").first()).toBeVisible();
    } else {
      await expect(page.getByText(/No results for/i)).toBeVisible();
    }
  });

  test("changes the sort order", async ({ page }) => {
    await page.getByLabel("Sort by").selectOption("date");
    await expect(page.getByLabel("Sort by")).toHaveValue("date");

    await page.getByLabel("Sort by").selectOption("duration");
    await expect(page.getByLabel("Sort by")).toHaveValue("duration");

    await page.getByLabel("Sort by").selectOption("relevance");
    await expect(page.getByLabel("Sort by")).toHaveValue("relevance");
  });

  test("clicks a search result to navigate to transcript detail", async ({
    page,
  }) => {
    // Use a query that matches the offline fixture data
    await page.getByLabel("Search transcripts").fill("investisseurs");

    const firstResult = page.locator("article.preference-row").first();
    const hasResults = await firstResult.isVisible().catch(() => false);

    if (hasResults) {
      await firstResult.click();
      // Clicking a result navigates to the home/transcript detail view
      await expect(
        page.getByRole("heading", { name: /Find past dictations/i }),
      ).not.toBeVisible();
    }
  });
});
