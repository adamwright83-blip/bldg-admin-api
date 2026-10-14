/* LEGACY DAYFORGE COMPATIBILITY: disposable historical SQL names only; current product is JOYSTICK. */
import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { cleanupOwner, database, login, provisionOwner, rpc } from "../real/helpers";
import { setActiveMacroGoal } from "../../server/claire/macroGoalService";
import { resolveCanonicalOperatorIdentity } from "../../server/agents/persistentOperator/identity";
import { activateMacroGoalAndQueue } from "../../server/agents/persistentOperator/goalCycleService";
import { defaultVerticalRegistry } from "../../server/strategy/verticalTemplates/defaultRegistry";
import { persistStrategicProposal } from "../../server/strategy/strategicStore";
import type { StrategicPlanningProposal } from "../../shared/strategicIntelligence";

const SHOTS = "artifacts/claire-strategy/acceptance/browser/desk";

test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] } });

test("Claire Desk: exact mission approval, Day Line, confirm tomorrow feedback, independent call activation, comms fallbacks", async ({ browser }) => {
  const owner = await provisionOwner("Claire desk acceptance");
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4187" });
  const db = await database();
  await mkdir(SHOTS, { recursive: true });
  try {
    await db.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,'persistent_operator','manual',true)", [owner.tenantId]);
    await db.execute("UPDATE dayforge_saas_tenants SET strategyVerticalKey='laundry_fluff_fold' WHERE id=?", [owner.tenantId]);
    await setActiveMacroGoal({
      tenantId: owner.tenantId, operatorUserId: owner.openId, objective: "Win back lapsed customers",
      metricKey: "paid_orders_per_period", targetValue: 100, unit: "orders", source: "operator_attested", sourceNote: "Synthetic desk acceptance fixture",
    });
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: owner.tenantId, source: { type: "open_id", value: owner.openId }, subsystem: "acceptance.fixture" });
    if (!resolved.ok) throw new Error("Fixture owner unavailable");
    await activateMacroGoalAndQueue({ tenantId: owner.tenantId, identity: resolved.identity, verticalKey: "laundry_fluff_fold", policyVersion: "v1", registry: defaultVerticalRegistry });

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));
    await login(page, owner);
    const prepared = (await rpc(context.request, "system.weeklyMission.refreshPreparedProposal", undefined, true)) as StrategicPlanningProposal;
    // Labelled fixture derived from the actual preparation: one sales mission today, one tomorrow.
    const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()));
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const revision = createHash("sha256").update(prepared.revision + randomUUID()).digest("hex");
    const fixture = await persistStrategicProposal({
      ...prepared,
      id: `proposal_${revision.slice(0, 40)}`,
      revision,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      items: [
        { ...prepared.items[0]!, id: `${today}:desk-winback-${revision.slice(0, 8)}`, businessDate: today, title: "Win back lapsed customers (desk fixture)", objective: "Call your five highest-spending lapsed customers; record replies and orders." },
        { ...prepared.items[0]!, id: `${tomorrow}:desk-second-${revision.slice(0, 8)}`, businessDate: tomorrow, title: "Desk fixture second mission", objective: "Bounded test fixture" },
      ],
    });

    // 1. The opportunity and the one mission are visible immediately.
    await page.goto("/claire", { waitUntil: "domcontentloaded" });
    const primary = page.getByTestId("claire-desk-primary-mission");
    await expect(primary).toContainText(fixture.items[0]!.title);
    await expect(primary).toContainText("Needs your approval");
    await expect(page.getByTestId("claire-desk-secondary-mission")).toContainText(fixture.items[1]!.title);
    await page.screenshot({ path: `${SHOTS}/1-before-approval.png`, fullPage: true });

    // 2. Exact approval of only the primary mission, with verified feedback and Day Line write.
    await primary.getByRole("button", { name: "Approve this mission", exact: true }).click();
    await expect(page.getByTestId("approve-result")).toContainText("1 approved item(s) added and verified in the Day Line");
    await expect(primary).toContainText("On your Day Line");
    const [rows]: any = await db.execute("SELECT id,title,businessDate FROM day_director_commitments WHERE tenantId=? AND title IN (?,?)", [owner.tenantId, fixture.items[0]!.title, fixture.items[1]!.title]);
    expect(rows.map((r: any) => r.title)).toEqual([fixture.items[0]!.title]);
    const line = await rpc(context.request, "system.currentDayLine.today");
    expect(JSON.stringify(line)).toContain(rows[0].id);
    await page.screenshot({ path: `${SHOTS}/2-after-approval.png`, fullPage: true });

    // 3. CONFIRM TOMORROW: a failed save says so and offers retry; a real save reads back.
    const confirm = page.getByTestId("confirm-tomorrow");
    await page.route("**/api/trpc/system.claire.confirmTomorrow**", route => route.abort("failed"));
    await confirm.getByTestId("confirm-tomorrow-button").click();
    await expect(page.getByTestId("confirm-tomorrow-result")).toContainText("Not saved");
    await expect(confirm.getByTestId("confirm-tomorrow-button")).toHaveText("Retry confirm tomorrow");
    await page.unroute("**/api/trpc/system.claire.confirmTomorrow**");
    await confirm.getByTestId("confirm-tomorrow-button").click();
    await expect(page.getByTestId("confirm-tomorrow-result")).toContainText("Saved tomorrow's plan snapshot");
    await expect(page.getByTestId("confirm-tomorrow-result")).toContainText("Still needs your approval: " + fixture.items[1]!.title);
    await page.screenshot({ path: `${SHOTS}/3-confirm-tomorrow.png`, fullPage: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("confirm-tomorrow-already")).toContainText("Tomorrow already confirmed");

    // 4. Morning and evening permissions are independent explicit grants with readback.
    const grants = async () =>
      ((await db.execute("SELECT exactAction FROM tenant_standing_authorizations WHERE tenantId=? AND revokedAt IS NULL", [owner.tenantId])) as any)[0].map((r: any) => r.exactAction).sort();
    expect(await grants()).toEqual([]);
    const routine = page.getByTestId("activate-routine");
    await routine.getByTestId("activate-morning_readiness").click();
    await expect(routine.getByTestId("activate-morning_readiness-result")).toContainText("Verified. First call window");
    expect(await grants()).toEqual(["claire.morning_readiness.call"]);
    await routine.getByTestId("activate-evening_debrief").click();
    await expect(routine.getByTestId("activate-evening_debrief-result")).toContainText("Verified. First call window");
    expect(await grants()).toEqual(["claire.evening_debrief.call", "claire.morning_readiness.call"]);
    const [authRows]: any = await db.execute("SELECT exactAction,allowedWeekdaysJson,allowedLocalStart,allowedLocalEnd FROM tenant_standing_authorizations WHERE tenantId=? AND revokedAt IS NULL ORDER BY exactAction", [owner.tenantId]);
    expect(authRows.map((r: any) => [r.exactAction, JSON.stringify(typeof r.allowedWeekdaysJson === "string" ? JSON.parse(r.allowedWeekdaysJson) : r.allowedWeekdaysJson), r.allowedLocalStart, r.allowedLocalEnd])).toEqual([
      ["claire.evening_debrief.call", "[1,2,3,4,5,6]", "17:30", "19:00"],
      ["claire.morning_readiness.call", "[1,2,3,4,5,6,7]", "07:30", "09:00"],
    ]);

    // 5. OPEN COMMS fallbacks without a model or voice provider: honest, nothing claimed saved.
    await page.getByTestId("open-comms-button").click();
    await expect(page.getByTestId("open-comms-log")).toContainText("Claire here.");
    await expect(page.getByTestId("open-comms-voice-note")).toContainText("Claire's voice isn't configured here");
    await page.getByTestId("open-comms-input").fill("Move the win-back to 10 tomorrow.");
    await page.getByTestId("open-comms-input").press("Enter");
    await expect(page.getByTestId("open-comms-log")).toContainText("Claire heard: Move the win-back to 10 tomorrow.");
    await expect(page.getByTestId("open-comms-log")).toContainText("Sorry, I lost that for a second");
    await expect(page.getByTestId("open-comms-saved")).toHaveCount(0);
    await page.getByTestId("open-comms-end").click();
    await expect(page.getByTestId("open-comms-button")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/4-comms-fallback.png`, fullPage: true });

    // 6. Responsive: no horizontal scroll on a phone.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(primary).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: `${SHOTS}/5-mobile.png`, fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await cleanupOwner(owner).catch(() => undefined);
    await db.end();
  }
});
