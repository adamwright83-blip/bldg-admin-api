import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/goldline",
  testMatch: ["daylineGraphicActions.spec.ts", "daylineViewport.spec.ts", "driverPickupFlow.spec.ts"],
  timeout: 60000,
  workers: 2,
  retries: 0,
  use: {
    baseURL: "http://localhost:4188",
    browserName: "chromium",
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: "pnpm exec vite preview --port 4188 --host 127.0.0.1",
    url: "http://localhost:4188/driver",
    reuseExistingServer: false,
  },
});
