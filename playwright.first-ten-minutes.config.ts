import { defineConfig, devices } from "@playwright/test";

/**
 * JOYSTICK's first ten minutes, end to end: the real server and page against a disposable MySQL, with Google and
 * Slack played by e2e/first-ten-minutes/fakeProviders.mjs. Started by scripts/first-ten-e2e.sh.
 *
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a locally installed Chromium when the bundled one is absent.
 */
const baseURL = process.env.FIRST_TEN_E2E_BASE_URL ?? "http://127.0.0.1:3300";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e/first-ten-minutes",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: "list",
  outputDir: "tmp/first-ten-e2e-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { executablePath } } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, launchOptions: { executablePath } },
    },
  ],
});
