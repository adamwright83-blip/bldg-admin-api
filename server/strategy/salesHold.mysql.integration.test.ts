/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { addCalendarDays } from "../../shared/weeklyGrowthCandidates";
import { weekStartMonday } from "../../shared/weeklyMissionReadiness";
import { DEFAULT_DOCTRINE, type ProactiveObligation } from "../../shared/claireProactive";
import type { StrategicPlanningProposal } from "../../shared/strategicIntelligence";
import { bindOperatorIdentityAlias, resolveCanonicalOperatorIdentity, type CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { upsertPersistentOperatorObligation } from "../agents/persistentOperator/obligationStore";
import { loadOperatorDoctrine, loadOperatorSalesHold, saveOperatorDoctrine } from "../agents/persistentOperator/operatorDoctrineStore";
import { handleDoctrineTurn } from "../claire/proactive/boardService";
import { captureShowrunnerSalesHold } from "../claire/showrunner/showrunnerTurn";
import { loadRankingContext } from "../planning/missionDirector/missionDirectorService";
import { rankMissionDirectorWork } from "../planning/missionDirector/rankableWork";
import { loadWeeklyGrowthCandidates } from "../weeklyGrowthCandidates/loadWeeklyGrowthCandidates";
import { respondToStrategicProposal } from "./strategicApproval";
import { persistStrategicProposal } from "./strategicStore";

/**
 * Real-MySQL proof of the operator's one-day sales hold:
 * - "No sales today", said on a call, holds acquisition, upselling, promotion
 *   and win-backs; a narrower instruction holds only what it names.
 * - Mission Director does not rank held work, and approval refuses it, so it
 *   never reaches the Day Line. The next day is untouched.
 * - "Resume sales now" lifts the hold everywhere it was saved, and starts
 *   nothing: held work only becomes rankable and approvable again.
 * - The hold is dated in the business's own time zone.
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

  async function user(tenantId: string, openId: string) {
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, openId, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, openId]);
  }

  async function operator(timeZone = zone, withAlias = false) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `hold-${suffix}`;
    const openId = `hold-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Sales hold test", "Sales hold test", "#123456", "Op", "op@example.invalid", timeZone]
    );
    await user(tenantId, openId);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const aliasOpenId = `hold-desk-${suffix}`;
    if (withAlias) {
      await user(tenantId, aliasOpenId);
      await bindOperatorIdentityAlias({ tenantId, canonicalOpenId: openId, aliasOpenId, surface: "operator", createdByOpenId: openId });
    }
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: openId }, subsystem: "sales_hold_test" });
    if (!resolved.ok) throw new Error("identity");
    return { identity: resolved.identity, aliasOpenId };
  }

  const openIds = (identity: CanonicalOperatorIdentity) => [identity.canonicalOpenId, ...identity.aliases.map(a => a.openId)];
  const call = (identity: CanonicalOperatorIdentity, businessDate: string) => ({
    tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, businessDate, timeZone: zone,
  });

  async function obligations(identity: CanonicalOperatorIdentity, today: string) {
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
    return { sales, recovery };
  }

  async function ranked(identity: CanonicalOperatorIdentity, businessDate: string, now: Date, of: { sales: ProactiveObligation; recovery: ProactiveObligation }) {
    const feed = await loadWeeklyGrowthCandidates({
      tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, dayDirectorActorId: identity.dayDirectorActorId,
      remainingDates: [businessDate], businessDate, now, timeZone: zone,
    });
    const context = await loadRankingContext({ tenantId: identity.tenantId, operatorUserIds: openIds(identity), businessDate });
    const plan = rankMissionDirectorWork({ candidates: feed.candidates, campaigns: [], campaignPrepReady: {}, context, pockets: [] });
    const held = (o: ProactiveObligation) =>
      plan.ranking.find(r => r.sourceRefs.some(ref => ref.sourceId === o.id))!.blockedReasons.includes("SALES_HELD_BY_OPERATOR");
    return { hold: context.salesHold ?? null, sales: held(of.sales), recovery: held(of.recovery) };
  }

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

  it("'no sales today' on a call holds the follow-up and the win-back; 'resume sales now' lifts it and starts nothing", async () => {
    const { identity } = await operator();
    const now = new Date();
    const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
    const work = await obligations(identity, today);
    expect(await ranked(identity, today, now, work)).toMatchObject({ hold: null, sales: false, recovery: false });

    // Morning call.
    expect(await captureShowrunnerSalesHold(call(identity, today), "Just today, don't give me sales work until payroll is finished.", now)).toBe(
      'Just today I\'ll hold all sales work until payroll is finished: new-customer outreach, upselling, promotions and win-backs. Customer service and existing orders go ahead. Say "resume sales" when you\'re ready.'
    );
    // Not a hold: falls through to the normal turn, nothing saved.
    expect(await captureShowrunnerSalesHold(call(identity, today), "Skip the OPUS pickup today.", now)).toBeNull();
    expect(await ranked(identity, today, now, work)).toMatchObject({ hold: { until: today }, sales: true, recovery: true });
    expect(await ranked(identity, addCalendarDays(today, 1), now, work)).toMatchObject({ hold: null, sales: false, recovery: false });

    // Later, in Desk Comms.
    expect(await captureShowrunnerSalesHold({ ...call(identity, today) }, "Resume sales now.", now)).toBe(
      "Sales work is back on. Nothing that was held starts by itself; I'll bring it back as a proposal for your OK."
    );
    expect(await ranked(identity, today, now, work)).toMatchObject({ hold: null, sales: false, recovery: false });
    expect(await commitments(identity.tenantId)).toEqual([]);
    expect((await loadOperatorDoctrine({ tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId })).salesHoldLiftedAt).toBe(now.toISOString());
  });

  it("a narrower instruction holds only what it names", async () => {
    const { identity } = await operator();
    const now = new Date();
    const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
    const work = await obligations(identity, today);
    expect(
      await handleDoctrineTurn({ tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, utterance: "No new-customer outreach today.", today, now })
    ).toBe('Just today I\'ll hold new-customer outreach. Everything else goes ahead. Say "resume sales" when you\'re ready.');
    expect(await ranked(identity, today, now, work)).toMatchObject({ hold: { scope: ["acquisition"] }, sales: true, recovery: false });
  });

  it("approval refuses held work and writes nothing; after 'resume sales' the same items approve", async () => {
    const { identity } = await operator();
    const now = new Date();
    const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
    // The held day is tomorrow so the 5 PM execution window never decides this test.
    const heldDay = addCalendarDays(today, 1);
    await saveOperatorDoctrine({
      tenantId: identity.tenantId,
      operatorUserId: identity.canonicalOpenId,
      rules: { ...DEFAULT_DOCTRINE, skipSalesUntil: heldDay, skipSalesReason: "Skip sales until payroll is done." },
    });
    // Read across every open id the operator may have spoken from; an unknown id adds nothing.
    expect(await loadOperatorSalesHold({ tenantId: identity.tenantId, operatorUserIds: [`not-${identity.canonicalOpenId}`, ...openIds(identity)] }))
      .toMatchObject({ until: heldDay, reason: "Skip sales until payroll is done." });
    const afterHold = addCalendarDays(heldDay, 1);
    const p = await proposal(identity, now, [
      { key: "sunset-towers", businessDate: heldDay, missionType: "account_acquisition" },
      { key: "ines", businessDate: heldDay, missionType: "retention" },
      { key: "the-wilshire", businessDate: afterHold, missionType: "commercial_follow_up" },
    ]);
    const approve = (itemIds: string[]) =>
      respondToStrategicProposal({ identity, proposalId: p.id, revision: p.revision, action: "approve", itemIds, source: "authenticated_voice", now });

    // "Approve all" with held work in it, win-back included: nothing is approved.
    await expect(approve(p.items.map(i => i.id))).rejects.toThrow(
      `You asked to hold all sales work through ${heldDay}, and "Call sunset-towers", "Call ines" are held work on those days. Move them to another day, or say "resume sales", before approving; nothing was approved.`
    );
    expect(await commitments(identity.tenantId)).toEqual([]);
    expect((await approve([`${afterHold}:the-wilshire`])).failedItems).toEqual([]);
    expect(await commitments(identity.tenantId)).toEqual(["Call the-wilshire"]);

    // Resuming approves nothing by itself; the operator's approval still does.
    await handleDoctrineTurn({ tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, utterance: "Resume sales now.", today, now });
    expect(await commitments(identity.tenantId)).toEqual(["Call the-wilshire"]);
    expect((await approve([`${heldDay}:sunset-towers`, `${heldDay}:ines`])).failedItems).toEqual([]);
    expect(await commitments(identity.tenantId)).toEqual(["Call ines", "Call sunset-towers", "Call the-wilshire"]);
  });

  it("is dated in the business's own time zone, and resuming clears it under every open id", async () => {
    const { identity, aliasOpenId } = await operator("Asia/Tokyo", true);
    expect(openIds(identity)).toContain(aliasOpenId);
    // 09:00 in Los Angeles on the 19th is already the 20th in Tokyo.
    const now = new Date("2026-10-19T16:00:00.000Z");
    const dashboardToday = formatInTimeZone(now, zone, "yyyy-MM-dd");
    expect(dashboardToday).toBe("2026-10-19");

    // Said from the desk alias in open conversation; the turn's own date is the dashboard's.
    await handleDoctrineTurn({ tenantId: identity.tenantId, operatorUserId: aliasOpenId, utterance: "No sales today.", today: dashboardToday, now });
    expect((await loadOperatorDoctrine({ tenantId: identity.tenantId, operatorUserId: aliasOpenId })).skipSalesUntil).toBe("2026-10-20");
    expect(await loadOperatorSalesHold({ tenantId: identity.tenantId, operatorUserIds: openIds(identity) })).toMatchObject({ until: "2026-10-20" });

    // Lifted on a scheduled call under the canonical id: the alias's hold is cleared too.
    await captureShowrunnerSalesHold({ tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, businessDate: "2026-10-20", timeZone: "Asia/Tokyo" }, "Resume sales now.", now);
    expect(await loadOperatorSalesHold({ tenantId: identity.tenantId, operatorUserIds: openIds(identity) })).toBeNull();
  });
});
