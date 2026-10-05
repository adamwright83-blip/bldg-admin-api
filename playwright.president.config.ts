import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/president",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.PRESIDENT_BROWSER_BASE_URL ?? "http://127.0.0.1:4189",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
  },
});
