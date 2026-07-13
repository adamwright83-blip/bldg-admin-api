import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.DAYFORGE_RELEASE_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e/dayforge",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: process.env.DAYFORGE_RELEASE_EXTERNAL_SERVER === "1"
    ? undefined
    : {
        command: "NODE_ENV=ci DAYFORGE_RELEASE_TEST_MODE=1 PORT=4173 node dist/index.js",
        url: `${baseURL}/territory-preview`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          NODE_ENV: "ci",
          DAYFORGE_RELEASE_TEST_MODE: "1",
          PORT: "4173",
        },
      },
});
