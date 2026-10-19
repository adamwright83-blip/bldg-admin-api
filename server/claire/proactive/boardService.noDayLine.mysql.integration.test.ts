import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { describe, expect, it, vi } from "vitest";
import { dayDirectorCommitments } from "../../../drizzle/schema";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { getDb } from "../../db";

/**
 * Real-MySQL proof for Stage 1 Phase 1A: a proactive sweep prepares work that
 * reaches Mission Director as a rankable candidate, and writes no Day Line
 * commitment. Only the operator's approval does that.
 */
const followUpMissionId = 9_100_000 + Math.floor(Math.random() * 99_999);
vi.mock("../../domains/commercial/commercialFollowUpReadService", () => ({
  listOpenCommercialFollowUps: vi.fn(async () => [
    {
      id: `follow-${followUpMissionId}`,
      missionId: followUpMissionId,
      dueAt: new Date(Date.now() + 86_400_000),
      note: "Email the revised quote to the property manager.",
    },
  ]),
}));

const { ensureOperatorBoard, loadObligations } = await import("./boardService");
const { loadWeeklyGrowthCandidates } = await import("../../weeklyGrowthCandidates/loadWeeklyGrowthCandidates");
const { rankMissionDirectorWork } = await import("../../planning/missionDirector/rankableWork");

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("proactive board on MySQL: prepares for Mission Director, never commits", () => {
  it("a sweep's obligation is a rankable Mission Director candidate and no commitment exists", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `board-1a-${suffix}`;
    const operatorUserId = `op-${suffix}`;
    const actorId = `actor-${suffix}`;
    const now = new Date();
    const today = formatInTimeZone(now, zone, "yyyy-MM-dd");

    const result = await ensureOperatorBoard({
      tenantId,
      operatorUserId,
      actorId,
      timeZone: zone,
      recoveryDraftIdentity: { storeName: "Laundry Farm", senderName: "Adam", serviceLabel: "laundry" },
      force: true,
    });
    expect(result.created).toBe(1);

    const obligations = await loadObligations(tenantId, operatorUserId);
    const prepared = obligations.find(item => item.kind === "sales_follow_up" && item.subjectKey === String(followUpMissionId));
    expect(prepared?.status).toBe("scheduled");

    // Nothing reached the Day Line without approval.
    const commitments = await db
      .select({ id: dayDirectorCommitments.id })
      .from(dayDirectorCommitments)
      .where(eq(dayDirectorCommitments.tenantId, tenantId));
    expect(commitments).toEqual([]);

    // Mission Director sees the prepared obligation as rankable, not already in flight.
    const feed = await loadWeeklyGrowthCandidates({
      tenantId,
      operatorUserId,
      dayDirectorActorId: actorId,
      remainingDates: Array.from({ length: 7 }, (_, i) => addDaysYmd(today, i)),
      now,
      timeZone: zone,
    });
    expect(feed.sources.proactive_obligation.status).toBe("available");
    const candidate = feed.candidates.find(c => c.sourceRefs.some(ref => ref.sourceId === prepared!.id));
    expect(candidate).toBeDefined();
    expect(candidate!.sourceKind).toBe("proactive_obligation");
    expect(candidate!.alreadyInFlight).toBe(false);

    // With nothing else competing, it is the work Mission Director proposes for approval.
    const plan = rankMissionDirectorWork({
      candidates: feed.candidates,
      campaigns: [],
      campaignPrepReady: {},
      context: { businessDate: today, macroGoal: null, openTasks: [] },
      pockets: [],
    });
    expect(plan.status).toBe("ranked");
    if (plan.status === "ranked") expect(plan.primary.workId).toBe(candidate!.id);

    // A second sweep is idempotent and still commits nothing.
    await ensureOperatorBoard({
      tenantId,
      operatorUserId,
      actorId,
      timeZone: zone,
      recoveryDraftIdentity: { storeName: "Laundry Farm", senderName: "Adam", serviceLabel: "laundry" },
      force: true,
    });
    const after = await db
      .select({ id: dayDirectorCommitments.id })
      .from(dayDirectorCommitments)
      .where(eq(dayDirectorCommitments.tenantId, tenantId));
    expect(after).toEqual([]);
  }, 60_000);
});
