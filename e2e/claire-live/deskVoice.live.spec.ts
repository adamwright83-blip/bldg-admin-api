import { test, expect, type Response } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * Live Claire Desk acceptance on a disposable copy of real business data.
 * Requires DESK_LIVE_BASE_URL (a local server, never production),
 * DESK_LIVE_ADMIN_PASSWORD (that server's local test password) and
 * DESK_LIVE_MIC_WAV (recorded operator speech fed to the fake microphone).
 */
const base = process.env.DESK_LIVE_BASE_URL ?? "";
test.skip(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base), "local live server only");
const OUT = "artifacts/claire-desk/live";

test("real data: sales mission approval, OPEN COMMS voice turns, interruptions, plan change with ambiguous and exact approval, failure", async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  const evidence: Record<string, unknown> = {};
  const voice: Array<{ status: number; type: string | null; bytes: number }> = [];
  page.on("response", async (r: Response) => {
    if (!r.url().includes("/api/claire/voice/xai")) return;
    const body = await r.body().catch(() => Buffer.alloc(0));
    voice.push({ status: r.status(), type: r.headers()["content-type"] ?? null, bytes: body.length });
    if (voice.length === 1 && body.length) await writeFile(`${OUT}/claire-voice-sample.mp3`, body);
  });
  const played: string[] = [];
  await page.exposeFunction("__deskAudioEvent", (e: string) => played.push(e));
  await page.addInitScript(() => {
    const p = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as any).__deskAudioEvent(`play:${(this as HTMLMediaElement).src.includes("/api/claire/voice/xai") ? "claire" : "other"}`);
      this.addEventListener("ended", () => (window as any).__deskAudioEvent("ended"), { once: true });
      this.addEventListener("pause", () => (window as any).__deskAudioEvent("pause"), { once: true });
      return p.call(this);
    };
  });

  const login = await page.request.post("/api/auth/login", { data: { password: process.env.DESK_LIVE_ADMIN_PASSWORD } });
  expect(login.status()).toBe(200);
  await page.goto("/claire", { waitUntil: "domcontentloaded" });

  // The sales opportunity and the five-customer call sheet are visible at once.
  await expect(page.getByTestId("claire-desk-opportunity")).toContainText("lapsed Silver Lake customers");
  const sheet = page.getByTestId("claire-desk-call-sheet");
  await expect(sheet.locator("li")).toHaveCount(5);
  await expect(sheet.locator("a[href^='tel:']")).toHaveCount(5);
  await page.screenshot({ path: `${OUT}/1-desk-real-data.png`, fullPage: true });

  // Exact approval of the win-back mission.
  const primary = page.getByTestId("claire-desk-primary-mission");
  await expect(primary).toContainText("Win back lapsed Silver Lake customers");
  await primary.getByRole("button", { name: "Approve this mission", exact: true }).click();
  await expect(page.getByTestId("approve-result")).toContainText("verified in the Day Line: Win back lapsed Silver Lake customers");
  await expect(primary).toContainText("On your Day Line");

  // OPEN COMMS: microphone, transcription, Claire's own voice, barge-in.
  await page.getByTestId("open-comms-button").click();
  const log = page.getByTestId("open-comms-log");
  await expect(log).toContainText("Claire here.");
  await expect(log).toContainText(/Claire heard:.*money/i, { timeout: 90_000 });
  await expect(log.locator("li.cd-line-claire").nth(1)).toBeVisible({ timeout: 90_000 });
  evidence.firstAnswer = await log.locator("li.cd-line-claire").nth(1).innerText();
  await expect(log).toContainText(/Claire heard:.*(stop|call first)/i, { timeout: 120_000 });
  evidence.secondHeard = await log.locator("li.cd-line-you").nth(1).innerText();
  await expect(log.locator("li.cd-line-claire").nth(2)).toBeVisible({ timeout: 90_000 });
  evidence.secondAnswer = await log.locator("li.cd-line-claire").nth(2).innerText();
  evidence.voiceNote = await page.getByTestId("open-comms-voice-note").innerText().catch(() => null);
  await page.screenshot({ path: `${OUT}/2-voice-turns.png`, fullPage: true });

  // Natural reporting and a plan change by text, with ambiguous then exact approval.
  const type = async (text: string) => {
    const before = await log.locator("li.cd-line-claire").count();
    await page.getByTestId("open-comms-input").fill(text);
    await page.getByTestId("open-comms-input").press("Enter");
    await expect(log.locator("li.cd-line-claire")).toHaveCount(before + 1, { timeout: 90_000 });
    return log.locator("li.cd-line-claire").last().innerText();
  };
  evidence.report = await type("I called Aimee Smith, she wants a pickup Friday morning. Liliana Markey didn't answer, I left a voicemail.");
  evidence.change = await type("Claire, actually, move the win-back calls to 10 tomorrow. I'm not sure about the Louise follow-up. And remind me to bring the customer list.");
  await expect(page.getByTestId("open-comms-pending")).toContainText("tomorrow at 10 AM");
  await expect(page.getByTestId("open-comms-saved")).toContainText("bring the customer list");
  evidence.ambiguous = await type("Yes, but make it 11.");
  await expect(page.getByTestId("open-comms-saved")).not.toContainText("approved item");
  evidence.approve = await type("Yes, lock it in.");
  if (!/verified in the Day Line/.test(String(evidence.approve))) {
    // Claire may have re-proposed 11 AM from the correction; approving that exact revision is still a plain yes.
    evidence.approveAfterCorrection = await type("Yes, lock it in.");
  }
  await expect(page.getByTestId("open-comms-saved")).toContainText("verified in the Day Line");
  await expect(page.getByTestId("claire-desk-runway")).toContainText(/Tomorrow · Morning · 1[01]:00/);
  await expect(page.getByTestId("claire-desk-readiness")).toContainText("customer list");
  await page.screenshot({ path: `${OUT}/3-plan-change-verified.png`, fullPage: true });

  // A failed write is reported truthfully.
  await page.route("**/api/trpc/system.weeklyMission.deskComms**", r => r.abort("failed"));
  await page.getByTestId("open-comms-input").fill("Add a note for tomorrow.");
  await page.getByTestId("open-comms-input").press("Enter");
  await expect(page.getByTestId("open-comms-error")).toContainText("Nothing from that turn was saved");
  await page.unroute("**/api/trpc/system.weeklyMission.deskComms**");
  await page.getByTestId("open-comms-end").click();
  await expect(page.getByTestId("open-comms-button")).toBeVisible();
  await page.screenshot({ path: `${OUT}/4-after-comms.png`, fullPage: true });

  evidence.voiceResponses = voice;
  evidence.audioEvents = played;
  await writeFile(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));
  expect(voice.some(v => v.status === 200 && /audio/.test(v.type ?? "") && v.bytes > 1000)).toBe(true);
  expect(played).toContain("play:claire");
});
