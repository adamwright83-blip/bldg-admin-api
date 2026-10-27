import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4174";

export default defineConfig({
  testDir: "./e2e/goldline",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    viewport: { width: 412, height: 923 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2.625,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    /**
     * These long-lived Pixel/runtime suites validate the broader Goldline
     * world that exists BEHIND the current Day 1 / Colosseum opening gate.
     * The gate is production behaviour, not a failure of the world runtime.
     *
     * Seed the same persisted dismissal a real player gets after clearing the
     * opening act so old world-regression tests actually reach the subsystem
     * they claim to test. This storageState exists only in Playwright CI; it
     * cannot alter a production browser. A future Colosseum-specific E2E can
     * override storageState with an empty origin when it intentionally tests
     * first entry.
     */
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [
            { name: "goldline:day1:dismissed", value: "1" },
            // Driver Studio is the production default Day Line. These suites
            // regress the previous GOLDLINE Day Line, which stays reachable as
            // the driver's own opt-out (?dayline=legacy, remembered under this
            // key). Studio is covered by e2e/goldline/driverStudio.spec.ts
            // with an empty profile, i.e. the real default.
            { name: "joystick:dayline", value: "legacy" },
          ],
        },
      ],
    },
  },
  webServer: {
    command: "NODE_ENV=ci PORT=4174 node dist/index.js",
    url: `${baseURL}/driver`,
    reuseExistingServer: false,
    timeout: 120000,
    env: { ...process.env, NODE_ENV: "ci", PORT: "4174" },
  },
});
