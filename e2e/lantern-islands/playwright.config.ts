import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", workers: 1,
  use: { baseURL: "http://127.0.0.1:4189", viewport: { width: 1440, height: 900 } },
  webServer: { command: "pnpm exec vite --config e2e/lantern-islands/vite.config.ts --host 127.0.0.1 --port 4189", url: "http://127.0.0.1:4189/e2e/lantern-islands/fixture.html", reuseExistingServer: false },
});
