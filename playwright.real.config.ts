import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/real', open: 'never' }], ['json', { outputFile: 'test-results/real-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4186', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'real-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node dist/index.js',
    url: 'http://127.0.0.1:4186',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
