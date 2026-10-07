import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "kingdomTwo.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4191",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "pixel-7",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 412, height: 923 },
      },
    },
  ],
  webServer: {
    command:
      "pnpm exec vite --config e2e/boreslay/vite.config.ts --host 127.0.0.1 --port 4191",
    url: "http://127.0.0.1:4191/e2e/boreslay/fixture.html",
    reuseExistingServer: false,
  },
});
