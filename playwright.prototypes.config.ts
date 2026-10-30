import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

/**
 * Prototypes, played as the self-contained page anyone can open (no server): first "The Friday That Didn't Exist"
 * (client/src/pages/prototypes/fridayCircuit). The page is built before the tests run.
 *
 *   pnpm exec playwright test --config playwright.prototypes.config.ts
 *
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a locally installed Chromium when the bundled one is absent.
 */
execFileSync("node", ["scripts/prototypes/build-friday-circuit.mjs", "tmp/friday-circuit"], { stdio: "inherit" });

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e/prototypes",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: "list",
  outputDir: "tmp/prototypes-results",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, launchOptions: { executablePath } } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, launchOptions: { executablePath } },
    },
  ],
});
