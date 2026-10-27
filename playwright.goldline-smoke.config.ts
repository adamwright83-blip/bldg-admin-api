import { defineConfig, devices } from "@playwright/test";

/**
 * Fast Goldline Smoke.
 *
 * The inner whole-system gate. Deliberately small and quick so it can run on
 * every change, unlike the ~20 minute full mobile regression, which stays the
 * exhaustive pre-merge gate.
 *
 * Assumes a server already running against a disposable proof database — see
 * scripts/goldline-proof-server.sh — so the gate measures the app, not a boot.
 */
const baseURL = process.env.GOLDLINE_SMOKE_BASE_URL ?? "http://127.0.0.1:4177";

export default defineConfig({
  testDir: "./e2e/goldline-smoke",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: "list",
  use: {
    baseURL,
    // The business runs on Pacific time: Day Line, Home and the proof seed all use America/Los_Angeles dates.
    // A UTC browser on CI disagreed with them every evening after 5pm Pacific.
    timezoneId: "America/Los_Angeles",
    // These smoke journeys assert the previous GOLDLINE Day Line (day-plan-stop
    // cards, the world navigation menu). Driver Studio is the production
    // default; the legacy Day Line is the driver's remembered opt-out, pinned
    // here. Studio's own journey: e2e/goldline/driverStudio.spec.ts.
    storageState: {
      cookies: [],
      origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "joystick:dayline", value: "legacy" }] }],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
