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
  },
  webServer: {
    command: "NODE_ENV=ci PORT=4174 node dist/index.js",
    url: `${baseURL}/driver`,
    reuseExistingServer: false,
    timeout: 120000,
    env: { ...process.env, NODE_ENV: "ci", PORT: "4174" },
  },
});
