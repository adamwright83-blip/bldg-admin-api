import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "intake.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4193",
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command:
      "pnpm exec vite --config e2e/cleancloud-intake/vite.config.ts --host 127.0.0.1 --port 4193",
    url: "http://127.0.0.1:4193/e2e/cleancloud-intake/fixture.html",
    reuseExistingServer: false,
  },
});
