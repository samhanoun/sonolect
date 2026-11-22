import { defineConfig, devices } from "@playwright/test";

// A machine that cannot use port 5174 or Playwright's own Chromium can pick
// others. CI sets neither, so it keeps port 5174 and the bundled browser.
const port = Number(process.env.SONOLECT_E2E_PORT) || 5174;
const chromium = process.env.SONOLECT_E2E_CHROMIUM?.trim();
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: {
      ...(chromium ? { executablePath: chromium } : {}),
      // A synthetic microphone, allowed without a prompt, for the tests that
      // record or pick an input. Tests with their own mock replace it.
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
