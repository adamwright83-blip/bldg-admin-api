/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only (disposable-database tenant table); not current architecture. */
/**
 * PR #606 on a disposable MySQL: planForDate stores a new revision only when
 * the inputs change, and pays for an explanation only then. Business readers
 * are fixed so the inputs are controlled; persistence, revisions and the
 * tenant lock are real.
 *
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3307/md_cost node scripts/migrate.mjs
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3307/md_cost ALLOW_TEST_DB=1 \
 *     pnpm vitest run --config vitest.integration.config.ts server/planning/missionDirector/explanationCost.mysql.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  explain: vi.fn(async () => ({ explanation: "Model explanation.", intelligence: "anthropic" as const })),
  candidateFingerprint: "candidates-v1",
}));

vi.mock("./explainPlan", () => ({ explainMissionPlan: hoisted.explain }));
vi.mock("../../campaignLibrary/campaignLibraryService", () => ({ listCampaigns: async () => [] }));
vi.mock("../../field/fieldTodayService", () => ({ getFieldToday: async () => ({ timeline: [] }) }));
vi.mock("../../claire/dailyCommandContract", () => ({ loadDailyCommand: async () => null }));
vi.mock("../../claire/macroGoalService", () => ({ getActiveMacroGoalForOperators: async () => null }));
vi.mock("../../claire/workdayRecurrenceService", () => ({ projectRecurrenceForDate: async () => ({ projectedIds: [], created: 0 }) }));
vi.mock("./prepReadiness", () => ({ computePrepReadiness: async () => ({}) }));
vi.mock("../../weeklyGrowthCandidates/loadWeeklyGrowthCandidates", () => ({
  loadWeeklyGrowthCandidates: async () => ({ candidates: [], fingerprint: hoisted.candidateFingerprint }),
}));
vi.mock("./rankableWork", () => ({
  rankMissionDirectorWork: () => ({ status: "ranked", primary: { sourceRefs: [{ sourceKind: "campaign_library", sourceId: "campaign-1" }] }, ranking: [], reason: null }),
}));
vi.mock("./planSelection", () => ({
  selectMissionPlan: () => ({ status: "planned", primary: { title: "Walk Greystar" }, fallback: { title: "Call two lapsed customers" }, ranking: [], explanation: "" }),
}));

const url = process.env.DATABASE_URL ?? "";
const describeMysql = url ? describe : describe.skip;

describeMysql("Mission Director explanation spend — disposable MySQL", () => {
  let sql: mysql.Connection;
  const tenantId = `md-cost-${randomUUID().slice(0, 8)}`;
  const base = { tenantId, operatorId: "op-1", operatorUserId: "operator-1", businessDate: "2026-10-16", timeZone: "America/Los_Angeles" };

  beforeAll(async () => {
    const host = new URL(url).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`refusing non-local database ${host}`);
    sql = await mysql.createConnection(url);
    await sql.query(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Cost test", "Cost test", "#123456", "Owner", "cost@example.invalid", "America/Los_Angeles"]
    );
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(() => {
    hoisted.explain.mockClear();
    hoisted.candidateFingerprint = "candidates-v1";
  });

  it("explains a new plan once, then re-plans with zero explanation calls while inputs are unchanged", async () => {
    const { planForDate } = await import("./missionDirectorService");
    const first = await planForDate(base);
    expect(hoisted.explain).toHaveBeenCalledTimes(1);
    expect(first.outcome).toMatchObject({ status: "planned", explanation: "Model explanation." });
    hoisted.explain.mockClear();
    for (let i = 0; i < 5; i++) {
      const again = await planForDate(base);
      expect(again.id).toBe(first.id);
      expect(again.revision).toBe(first.revision);
      expect(again.outcome).toMatchObject({ explanation: "Model explanation." });
    }
    expect(hoisted.explain).not.toHaveBeenCalled();
  });

  it("concurrent re-plans of the same day share one computation and pay nothing when unchanged", async () => {
    const { planForDate } = await import("./missionDirectorService");
    const runs = await Promise.all(Array.from({ length: 4 }, () => planForDate(base)));
    expect(new Set(runs.map(run => run.id)).size).toBe(1);
    expect(hoisted.explain).not.toHaveBeenCalled();
  });

  it("a genuinely changed input stores a new revision with its explanation", async () => {
    const { planForDate } = await import("./missionDirectorService");
    const before = await planForDate(base);
    hoisted.explain.mockClear();
    hoisted.candidateFingerprint = "candidates-v2";
    const after = await planForDate(base);
    expect(after.id).not.toBe(before.id);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.inputFingerprint).not.toBe(before.inputFingerprint);
    expect(hoisted.explain).toHaveBeenCalledTimes(1);
    expect(after.outcome).toMatchObject({ explanation: "Model explanation." });
  });

  it("never reuses a newer stored plan whose inputs differ (another replica wrote it)", async () => {
    const { planForDate } = await import("./missionDirectorService");
    hoisted.candidateFingerprint = "candidates-v3";
    const ours = await planForDate(base);
    // Another replica stores a plan for different inputs.
    hoisted.candidateFingerprint = "candidates-v4";
    const theirs = await planForDate(base);
    hoisted.explain.mockClear();
    // Our inputs again: the newest stored row (v4) must not be reused for v3.
    hoisted.candidateFingerprint = "candidates-v3";
    const back = await planForDate(base);
    expect(back.id).not.toBe(theirs.id);
    expect(back.inputFingerprint).toBe(ours.inputFingerprint);
    expect(hoisted.explain).toHaveBeenCalledTimes(1);
    const [rows] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT revision, inputFingerprint FROM mission_director_plans WHERE tenantId = ? ORDER BY revision",
      [tenantId]
    );
    expect(rows.map(row => row.revision)).toEqual(rows.map((_, index) => index + 1));
  });
});
