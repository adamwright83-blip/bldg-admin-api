import { defineConfig } from "@playwright/test";

/**
 * Local-only live acceptance for the Claire Desk: points at an already running
 * server on a disposable copy of real data (DESK_LIVE_BASE_URL) with the real
 * Claire model, voice and transcription. Never run against production.
 */
export default defineConfig({
  testDir: "./e2e/claire-live",
  workers: 1,
  retries: 0,
  timeout: 900_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.DESK_LIVE_BASE_URL,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${process.env.DESK_LIVE_MIC_WAV ?? ""}%noloop`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
});
