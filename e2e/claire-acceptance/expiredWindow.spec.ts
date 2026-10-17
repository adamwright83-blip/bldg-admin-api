/* LEGACY DAYFORGE COMPATIBILITY: disposable historical SQL names only; current product is JOYSTICK. */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { cleanupOwner, database, login, provisionOwner, rpc, type TestOwner } from "../real/helpers";
import { setActiveMacroGoal } from "../../server/claire/macroGoalService";
import { resolveCanonicalOperatorIdentity } from "../../server/agents/persistentOperator/identity";
import { activateMacroGoalAndQueue } from "../../server/agents/persistentOperator/goalCycleService";
import { defaultVerticalRegistry } from "../../server/strategy/verticalTemplates/defaultRegistry";
import { persistStrategicProposal } from "../../server/strategy/strategicStore";
import type { StrategicPlanningProposal, StrategicProposalItem } from "../../shared/strategicIntelligence";

/**
 * After the 5 PM execution cutoff, unapproved work dated today must be rescheduled, not
 * approved; an operator-stated later time stays valid. Nothing here mocks a clock or an
 * API: each business is placed in a fixed-offset time zone where it is about 8 PM right
 * now, so the real server judges the real cutoff whenever the suite runs.
 */

/** An IANA fixed-offset zone whose local time is 20:mm now (Etc/GMT signs are inverted). */
function eveningZone(now = new Date()) {
  let offset = (20 - now.getUTCHours() + 24) % 24;
  if (offset > 14) offset -= 24;
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}
const localClock = (zone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};

type Evening = {
  owner: TestOwner;
  context: BrowserContext;
  page: Page;
  db: Awaited<ReturnType<typeof database>>;
  today: string;
  base: Omit<StrategicProposalItem, "timeWindow">;
  publish: (items: Array<Partial<StrategicProposalItem> & { title: string }>) => Promise<StrategicPlanningProposal>;
  close: () => Promise<void>;
};

async function eveningBusiness(browser: Browser, label: string): Promise<Evening> {
  const owner = await provisionOwner(label);
  const zone = eveningZone();
  const db = await database();
  await db.execute("UPDATE dayforge_saas_tenants SET timeZone=?, strategyVerticalKey='laundry_fluff_fold' WHERE id=?", [zone, owner.tenantId]);
  await db.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,'persistent_operator','manual',true)", [owner.tenantId]);
  await setActiveMacroGoal({
    tenantId: owner.tenantId, operatorUserId: owner.openId, objective: "Win back lapsed customers",
    metricKey: "paid_orders_per_period", targetValue: 100, unit: "orders", source: "operator_attested", sourceNote: "Synthetic expired-window acceptance fixture",
  });
  const resolved = await resolveCanonicalOperatorIdentity({ tenantId: owner.tenantId, source: { type: "open_id", value: owner.openId }, subsystem: "acceptance.fixture" });
  if (!resolved.ok) throw new Error("Fixture owner unavailable");
  await activateMacroGoalAndQueue({ tenantId: owner.tenantId, identity: resolved.identity, verticalKey: "laundry_fluff_fold", policyVersion: "v1", registry: defaultVerticalRegistry });
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4187" });
  const page = await context.newPage();
  await login(page, owner);
  const prepared = (await rpc(context.request, "system.weeklyMission.refreshPreparedProposal", undefined, true)) as StrategicPlanningProposal;
  const clock = localClock(zone);
  // The premise of every test here: it is after 5 PM where this business is.
  expect(clock.time >= "17:00" && clock.time < "22:00", `local time ${clock.time} in ${zone}`).toBe(true);
  const { timeWindow: _none, ...base } = prepared.items[0]!;
  return {
    owner,
    context,
    page,
    db,
    today: clock.date,
    base,
    // Labelled fixture derived from the actual preparation; only the items are chosen.
    publish: items => {
      const revision = createHash("sha256").update(prepared.revision + randomUUID()).digest("hex");
      return persistStrategicProposal({
        ...prepared,
        id: `proposal_${revision.slice(0, 40)}`,
        revision,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        items: items.map((item, n) => ({ ...base, businessDate: clock.date, ...item, id: `${item.businessDate ?? clock.date}:expired-window-${n}-${revision.slice(0, 8)}` })),
      });
    },
    close: async () => {
      await context.close();
      await cleanupOwner(owner).catch(() => undefined);
      await db.end();
    },
  };
}

const operatorTime = (time: string) => ({ window: "evening" as const, time, reason: "Time you reported.", sourceObservationId: "operator_report:acceptance" });
const panelItem = (page: Page, title: string) => page.getByTestId("claire-strategic-proposal").getByRole("listitem").filter({ hasText: title });
const commitments = async (e: Evening) =>
  ((await e.db.execute("SELECT title, DATE_FORMAT(businessDate,'%Y-%m-%d') AS d FROM day_director_commitments WHERE tenantId=? ORDER BY title", [e.owner.tenantId])) as any)[0] as Array<{ title: string; d: string }>;
async function approveByApi(e: Evening, p: StrategicPlanningProposal, itemIds: string[]) {
  const r = await e.context.request.post("/api/trpc/system.weeklyMission.respondToPreparedProposal", {
    data: { json: { proposalId: p.id, revision: p.revision, action: "approve", itemIds } },
  });
  return { ok: r.ok(), body: await r.text() };
}

test.describe("work whose execution window has passed", () => {
  test("1. an ordinary mission expires after 5 PM and stays visible with a reschedule option", async ({ browser }) => {
    const e = await eveningBusiness(browser, "Expired window: visible");
    try {
      const p = await e.publish([{ title: "Ordinary mission due today" }]);
      await e.page.goto("/claire", { waitUntil: "domcontentloaded" });
      const runway = e.page.getByTestId("claire-desk-runway");
      await expect(runway).toContainText("Ordinary mission due today");
      await expect(runway).toContainText("Time passed — reschedule");
      const primary = e.page.getByTestId("claire-desk-primary-mission");
      await expect(primary).toContainText("Ordinary mission due today");
      await expect(primary.getByTestId("claire-desk-needs-reschedule")).toBeVisible();
      await expect(primary.getByTestId("approve-primary-mission")).toHaveCount(0);

      const item = panelItem(e.page, "Ordinary mission due today");
      await expect(item).toContainText("time passed — reschedule");
      await expect(item.getByRole("checkbox")).toBeDisabled();
      const options = await item.getByRole("combobox").locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(0);
      expect(options.every(d => d > e.today)).toBe(true);
      await expect(item.getByRole("button", { name: "Reschedule", exact: true })).toBeEnabled();

      const state = (await rpc(e.context.request, "system.weeklyMission.preparedProposal")) as { expiredItemIds: string[] };
      expect(state.expiredItemIds).toEqual([p.items[0]!.id]);
    } finally {
      await e.close();
    }
  });

  test("2. the server refuses to approve the expired mission and writes nothing", async ({ browser }) => {
    const e = await eveningBusiness(browser, "Expired window: server refusal");
    try {
      const p = await e.publish([{ title: "Ordinary mission due today" }, { title: "Meeting the operator set for 23:30", timeWindow: operatorTime("23:30") }]);
      const alone = await approveByApi(e, p, [p.items[0]!.id]);
      expect(alone.ok).toBe(false);
      expect(alone.body).toContain("has passed. Reschedule it to a new day before approving; nothing was approved.");
      // A batch containing expired work is refused whole: the valid item is not slipped through.
      const mixed = await approveByApi(e, p, [p.items[0]!.id, p.items[1]!.id]);
      expect(mixed.ok).toBe(false);
      expect(await commitments(e)).toEqual([]);
      const [responses]: any = await e.db.execute("SELECT id FROM strategic_proposal_responses WHERE tenantId=? AND proposalId=?", [e.owner.tenantId, p.id]);
      expect(responses).toEqual([]);
    } finally {
      await e.close();
    }
  });

  test("3. rescheduling to a valid day persists in MySQL and restores approval", async ({ browser }) => {
    const e = await eveningBusiness(browser, "Expired window: reschedule");
    try {
      await e.publish([{ title: "Ordinary mission due today" }]);
      await e.page.goto("/claire", { waitUntil: "domcontentloaded" });
      const item = panelItem(e.page, "Ordinary mission due today");
      await expect(item).toContainText("time passed — reschedule");
      const target = (await item.getByRole("combobox").locator("option").allTextContents())[0]!;
      await item.getByRole("combobox").selectOption(target);
      await item.getByRole("button", { name: "Reschedule", exact: true }).click();
      await expect(e.page.getByTestId("claire-strategic-proposal")).toContainText(`Revised pending proposal: ${target}: Ordinary mission due today`);

      // Persisted: the newest stored revision dates the mission to the chosen day.
      const [rows]: any = await e.db.execute("SELECT id, payloadJson FROM strategic_planning_proposals WHERE tenantId=? ORDER BY createdAt DESC, id DESC LIMIT 1", [e.owner.tenantId]);
      const stored = (typeof rows[0].payloadJson === "string" ? JSON.parse(rows[0].payloadJson) : rows[0].payloadJson) as StrategicPlanningProposal;
      expect(stored.items.map(i => [i.title, i.businessDate])).toEqual([["Ordinary mission due today", target]]);
      const state = (await rpc(e.context.request, "system.weeklyMission.preparedProposal")) as { proposal: StrategicPlanningProposal; expiredItemIds: string[] };
      expect(state.proposal.id).toBe(rows[0].id);
      expect(state.expiredItemIds).toEqual([]);

      // Eligible again: approve it through the app and read the Day Line row back from MySQL.
      await expect(item).not.toContainText("time passed");
      await item.getByRole("checkbox").check();
      await e.page.getByTestId("claire-strategic-proposal").getByRole("button", { name: "Approve selected", exact: true }).click();
      await expect(e.page.getByTestId("claire-strategic-proposal")).toContainText("1 approved item(s) added and verified");
      expect(await commitments(e)).toEqual([{ title: "Ordinary mission due today", d: target }]);
    } finally {
      await e.close();
    }
  });

  test("4. an operator-specified later time stays valid; one that has passed does not", async ({ browser }) => {
    const e = await eveningBusiness(browser, "Expired window: operator time");
    try {
      await e.publish([
        { title: "Meeting the operator set for 23:30", timeWindow: operatorTime("23:30") },
        { title: "Meeting the operator set for 18:00", timeWindow: operatorTime("18:00") },
      ]);
      await e.page.goto("/claire", { waitUntil: "domcontentloaded" });
      const later = panelItem(e.page, "Meeting the operator set for 23:30");
      const passed = panelItem(e.page, "Meeting the operator set for 18:00");
      await expect(passed).toContainText("time passed — reschedule");
      await expect(passed.getByRole("checkbox")).toBeDisabled();
      await expect(later).not.toContainText("time passed");
      await later.getByRole("checkbox").check();
      await e.page.getByTestId("claire-strategic-proposal").getByRole("button", { name: "Approve selected", exact: true }).click();
      await expect(e.page.getByTestId("claire-strategic-proposal")).toContainText("1 approved item(s) added and verified");
      expect(await commitments(e)).toEqual([{ title: "Meeting the operator set for 23:30", d: e.today }]);
    } finally {
      await e.close();
    }
  });

  test("5. desk.spec's 23:59 fixture is the only thing keeping its mission approvable after 5 PM", async ({ browser }) => {
    const e = await eveningBusiness(browser, "Expired window: desk fixture");
    try {
      // desk.spec.ts's today mission, exactly, with and without its explicit 23:59 time.
      const objective = "Call your five highest-spending lapsed customers; record replies and orders.";
      await e.publish([
        { title: "Win back lapsed customers (desk fixture)", objective, timeWindow: { window: "evening", time: "23:59", reason: "Desk acceptance fixture: an explicit time tonight.", sourceObservationId: "acceptance_fixture" } },
        { title: "Win back lapsed customers (no time)", objective },
      ]);
      await e.page.goto("/claire", { waitUntil: "domcontentloaded" });
      const primary = e.page.getByTestId("claire-desk-primary-mission");
      await expect(primary).toContainText("Win back lapsed customers (desk fixture)");
      await expect(primary).toContainText("Needs your approval");
      const secondary = e.page.getByTestId("claire-desk-secondary-mission");
      await expect(secondary).toContainText("Win back lapsed customers (no time)");
      await expect(secondary).toContainText("Time passed — reschedule");
      await primary.getByRole("button", { name: "Approve this mission", exact: true }).click();
      await expect(e.page.getByTestId("approve-result")).toContainText("1 approved item(s) added and verified in the Day Line");
      expect(await commitments(e)).toEqual([{ title: "Win back lapsed customers (desk fixture)", d: e.today }]);
    } finally {
      await e.close();
    }
  });
});
