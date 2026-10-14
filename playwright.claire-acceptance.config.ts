/* LEGACY DAYFORGE COMPATIBILITY: retained historical literals (table/env names) only; not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e/claire-acceptance",
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: "artifacts/claire-strategy/acceptance/browser-results.json",
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:4187",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node dist/index.js",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DOTENV_CONFIG_PATH: "/dev/null",
      PORT: "4187",
      AUTONOMOUS_WORKERS_ENABLED: "0",
      GOLDLINE_AUTONOMOUS_WORKERS: "0",
      GOLDLINE_PROOF_MODE: "0",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      TWILIO_ACCOUNT_SID: "",
      TWILIO_AUTH_TOKEN: "",
      STRIPE_SECRET_KEY: "acceptance-placeholder-not-used",
      DAYFORGE_BILLING_STRIPE_SECRET_KEY:
        "sk_test_acceptance_placeholder_not_used",
      DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET: "whsec_acceptance_placeholder",
    },
  },
});
