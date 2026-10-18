/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { addCalendarDays } from "../../shared/weeklyGrowthCandidates";
import { weekStartMonday } from "../../shared/weeklyMissionReadiness";
import type { ProactiveObligation } from "../../shared/claireProactive";
import type { StrategicPlanningProposal } from "../../shared/strategicIntelligence";
import { resolveCanonicalOperatorIdentity, type CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { upsertPersistentOperatorObligation } from "../agents/persistentOperator/obligationStore";
import { loadOperatorSalesHold, saveOperatorDoctrine } from "../agents/persistentOperator/operatorDoctrineStore";
import { captureShowrunnerSalesHold } from "../claire/showrunner/showrunnerTurn";
import { loadRankingContext } from "../planning/missionDirector/missionDirectorService";
import { rankMissionDirectorWork } from "../planning/missionDirector/rankableWork";
import { loadWeeklyGrowthCandidates } from "../weeklyGrowthCandidates/loadWeeklyGrowthCandidates";
import { respondToStrategicProposal } from "./strategicApproval";
import { persistStrategicProposal } from "./strategicStore";
import { DEFAULT_DOCTRINE } from "../../shared/claireProactive";

/**
 * Real-MySQL proof: an operator's "no sales today", said on a scheduled call,
 * is saved, and every planner that could put sales work in front of them that
 * day honors it. Mission Director does not rank held sales work (recovery
 * still ranks), and approval refuses sales work dated on the held day, so it
 * never reaches the Day Line. The next day is untouched.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("the operator's sales hold on MySQL", () => {
  let sql: mysql.Connection;
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function operator() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `hold-${suffix}`;
    const openId = `hold-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Sales hold test", "Sales hold test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, openId, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, openId]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: openId }, subsystem: "sales_hold_test" });
    if (!resolved.ok) throw new Error("identity");
    return resolved.identity;
  }

  const openIds = (identity: CanonicalOperatorIdentity) => [identity.canonicalOpenId, ...identity.aliases.map(a => a.openId)];

  async function proposal(identity: CanonicalOperatorIdentity, now: Date, items: Array<{ key: string; businessDate: string; missionType: string }>) {
    const businessDate = formatInTimeZone(now, zone, "yyyy-MM-dd");
    const revision = createHash("sha256").update(randomUUID()).digest("hex");
    return persistStrategicProposal({
      id: `proposal_${revision.slice(0, 40)}`,
      schemaVersion: 1,
      revision,
      tenantId: identity.tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      operatorUserId: identity.canonicalOpenId,
      dayDirectorActorId: identity.dayDirectorActorId,
      weekStart: weekStartMonday(businessDate),
      businessDate,
      timeZone: zone,
      preparedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
      diagnosis: { id: `diagnosis_${revision.slice(0, 12)}`, actions: [], quality: { structuralErrors: [], judgment: "unreviewed", reasons: [] } },
      items: items.map(item => ({
        id: `${item.businessDate}:${item.key}`,
        businessDate: item.businessDate,
        title: `Call ${item.key}`,
        objective: `Call ${item.key} and record the answer`,
        executionType: "challenge" as const,
        candidateId: `candidate:${item.key}`,
        missionType: item.missionType,
        planId: `mission_director_plan:${item.key}`,
        planRevision: 1,
        evidenceRefs: [],
      })),
      constraints: [],
      uncertainty: [],
      opening: "Approve, revise, reject or defer.",
      approvalState: "pending",
    } as unknown as StrategicPlanningProposal);
  }

  async function commitments(tenantId: string) {
    const [rows] = await sql.execute<mysql.RowDataPacket[]>("SELECT title FROM day_director_commitments WHERE tenantId = ? ORDER BY title", [tenantId]);
    return rows.map(r => String(r.title));
  }

  it("said on a call, the hold is saved and Mission Director skips sales work that day, not recovery", async () => {
    const identity = await operator();
    const now = new Date();
    const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
    const tomorrow = addCalendarDays(today, 1);
    const obligation = (kind: ProactiveObligation["kind"], key: string): ProactiveObligation => ({
      // claire_proactive_obligations is keyed by id alone, so ids must not repeat across test tenants.
      id: `${kind === "sales_follow_up" ? "sales" : "recovery"}:${key}:${identity.tenantId}:${today}`,
      kind,
      subjectKey: kind === "sales_follow_up" ? `account:${key}` : `customer:${key}`,
      subjectName: key,
      status: "scheduled",
      dueDate: today,
      title: kind === "sales_follow_up" ? `Follow up: ${key}` : `Win back ${key}`,
      why: kind === "sales_follow_up" ? `${key} asked for a call back.` : `${key} has not ordered in 40 days.`,
      draft: null,
      historyIntact: true,
      moveCount: 0,
    });
    const sales = obligation("sales_follow_up", "Sunset Towers");
    const recovery = obligation("dormant_recovery", "Ines");
    for (const o of [sales, recovery])
      await upsertPersistentOperatorObligation({ tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, obligation: o });

    const ranked = async (businessDate: string) => {
      const feed = await loadWeeklyGrowthCandidates({
        tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, dayDirectorActorId: identity.dayDirectorActorId,
        remainingDates: [businessDate], businessDate, now, timeZone: zone,
      });
      const context = await loadRankingContext({ tenantId: identity.tenantId, operatorUserIds: openIds(identity), businessDate });
      const plan = rankMissionDirectorWork({ candidates: feed.candidates, campaigns: [], campaignPrepReady: {}, context, pockets: [] });
      const of = (o: ProactiveObligation) =>
        plan.ranking.find(r => r.sourceRefs.some(ref => ref.sourceId === o.id))!;
      return { context, sales: of(sales), recovery: of(recovery) };
    };

    const before = await ranked(today);
    expect(before.context.salesHold).toBeUndefined();
    expect(before.sales.blockedReasons).not.toContain("SALES_HELD_BY_OPERATOR");

    // Morning call: the operator holds sales for today.
    const speak = await captureShowrunnerSalesHold(
      { tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, businessDate: today },
      "Just today, don't give me sales work until payroll is finished."
    );
    expect(speak).toBe("Just today I'll hold sales work until payroll is finished. That doesn't change the standing rule.");
    // Not a hold: falls through to the normal turn, nothing saved.
    expect(
      await captureShowrunnerSalesHold({ tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, businessDate: today }, "Skip the OPUS pickup today.")
    ).toBeNull();

    const held = await ranked(today);
    expect(held.context.salesHold).toMatchObject({ until: today });
    expect(held.sales).toMatchObject({ eligible: false });
    expect(held.sales.blockedReasons).toContain("SALES_HELD_BY_OPERATOR");
    expect(held.recovery.blockedReasons).not.toContain("SALES_HELD_BY_OPERATOR");

    const next = await ranked(tomorrow);
    expect(next.context.salesHold).toBeUndefined();
    expect(next.sales.blockedReasons).not.toContain("SALES_HELD_BY_OPERATOR");
  });

  it("approval refuses sales work on the held day and writes nothing; recovery and the next day still approve", async () => {
    const identity = await operator();
    const now = new Date();
    const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
    const tomorrow = addCalendarDays(today, 1);
    // The held day is tomorrow so the 5 PM execution window never decides this test.
    const heldDay = tomorrow;
    await saveOperatorDoctrine({
      tenantId: identity.tenantId,
      operatorUserId: identity.canonicalOpenId,
      rules: { ...DEFAULT_DOCTRINE, skipSalesUntil: heldDay, skipSalesReason: "Skip sales until payroll is done." },
    });
    // Read across every open id the operator may have spoken from; an unknown id adds nothing.
    expect(await loadOperatorSalesHold({ tenantId: identity.tenantId, operatorUserIds: [`not-${identity.canonicalOpenId}`, ...openIds(identity)] }))
      .toEqual({ until: heldDay, reason: "Skip sales until payroll is done." });
    const afterHold = addCalendarDays(heldDay, 1);
    const p = await proposal(identity, now, [
      { key: "sunset-towers", businessDate: heldDay, missionType: "account_acquisition" },
      { key: "ines", businessDate: heldDay, missionType: "retention" },
      { key: "the-wilshire", businessDate: afterHold, missionType: "commercial_follow_up" },
    ]);
    const approve = (itemIds: string[]) =>
      respondToStrategicProposal({ identity, proposalId: p.id, revision: p.revision, action: "approve", itemIds, source: "authenticated_voice", now });

    // "Approve all" with held sales work in it: nothing is approved.
    await expect(approve(p.items.map(i => i.id))).rejects.toThrow(
      `You asked to hold sales work through ${heldDay}, and "Call sunset-towers" is sales work on that day. Move it to another day before approving; nothing was approved.`
    );
    expect(await commitments(identity.tenantId)).toEqual([]);

    const allowed = await approve([`${heldDay}:ines`, `${afterHold}:the-wilshire`]);
    expect(allowed.failedItems).toEqual([]);
    expect(await commitments(identity.tenantId)).toEqual(["Call ines", "Call the-wilshire"]);
  });
});
