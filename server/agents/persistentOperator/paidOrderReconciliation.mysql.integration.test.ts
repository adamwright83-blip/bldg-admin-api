/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readCanonicalRevenue } from "../../analytics/canonicalRevenue";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { sweepObservationBridges } from "./autonomousWorkerService";
import { bridgeCommitmentCompletion } from "./commitmentExecutionBridge";
import { createIsolatedGoalCycleDb } from "./goalCycleIsolatedDb.testSupport";
import { advance, at, createGoalLoopHarness, DAY, HOUR, startLosAngelesMorning, today, ZONE } from "./goalLoopHarness.testSupport";
import { claimDueObservationObligations, readObservationBridgeBacklog } from "./observationBridgeStore";
import { paidOrderObservationDeps } from "./paidOrderObservationBridge";
import { persistentOperatorRouter } from "./persistentOperatorRouter";

/**
 * Real-MySQL proof for Phase 2 · Slice D: a paid CleanCloud order's goal
 * observation is owned by a durable obligation from the moment its import
 * commits. Outages, a post-import step that never ran, a dead worker, a
 * customer identity that arrives later and an attempt still being linked are
 * all recovered by retry; what cannot be attributed is classified, never
 * guessed; and the paid-order ledger stays the one financial truth.
 *
 * Imports go through the browser-sync router (receipts admitted with the
 * row); attempts are real (goal-cycle decision, exact-revision approval,
 * completion through the Day Line router); retries run the worker's sweep.
 * Only `Date` is faked.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const BEA = { name: "Bea Lund", customerId: "c2", address: "1800 Griffith Park Blvd Los Angeles CA 90026", total: "61.00" };
const ALMA = { name: "Alma Reyes", customerId: "c1", address: "2300 Silver Lake Blvd Los Angeles CA 90039", total: "48.00" };
const CRUZ = { name: "Cruz Ortega", customerId: "c3", address: "3100 Sunset Blvd Los Angeles CA 90026", total: "40.00" };
const DANA = { name: "Dana Kim", customerId: "c4", address: "262 North Rodeo Drive Beverly Hills CA 90210", total: "33.00" };
const paysToday = (c: typeof BEA) => ({ ...c, daysAgo: [0] });

describeMysql("paid-order observation reconciliation on MySQL", () => {
  let sql: mysql.Connection;
  let iso: Awaited<ReturnType<typeof createIsolatedGoalCycleDb>>;
  let loop: ReturnType<typeof createGoalLoopHarness>;
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const productionDeps = { ...paidOrderObservationDeps };

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = "";
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    iso = await createIsolatedGoalCycleDb(process.env.DATABASE_URL!);
    loop = createGoalLoopHarness(sql, iso);
  }, 120_000);
  beforeEach(() => startLosAngelesMorning());
  afterEach(async () => {
    await loop.retireTenants();
    Object.assign(paidOrderObservationDeps, productionDeps);
    vi.useRealTimers();
  });
  afterAll(async () => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    await sql?.end();
    await iso?.drop();
  });

  const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);
  /** The newest paid order on record for a CleanCloud customer id. */
  async function latestOrder(tenantId: string, customerId: string | null, name?: string) {
    const [row] = await loop.rows(
      customerId
        ? "SELECT cleancloudOrderId, totalCents FROM cleancloud_paid_orders WHERE tenantId = ? AND cleancloudCustomerId = ? ORDER BY paymentDateUtc DESC, id DESC LIMIT 1"
        : "SELECT cleancloudOrderId, totalCents FROM cleancloud_paid_orders WHERE tenantId = ? AND customerName = ? ORDER BY paymentDateUtc DESC, id DESC LIMIT 1",
      [tenantId, customerId ?? name]
    );
    return String(row!.cleancloudOrderId);
  }
  const paidOutcomes = async (tenantId: string) => (await loop.outcomesOf(tenantId)).filter(o => o.outcomeKind === "cleancloud_order_paid");
  const importBatches = async (tenantId: string) => Number((await loop.rows("SELECT COUNT(*) AS n FROM cleancloud_import_batches WHERE tenantId = ?", [tenantId]))[0]!.n);

  it("recovers an outage, a post-import step that never ran, a dead worker and an identity that arrives later, each order once", async () => {
    const { t, store } = await loop.tenant({ prefix: "d" });
    const attempt = await loop.executeStrategyAttempt(t, store);
    expect(attempt.completed.goalEvidence).toMatchObject({ status: "recorded" });
    const objectiveId = attempt.completed.goalEvidence!.objectiveId!;

    // 1. Bea pays. The import commits (the order and its admitted receipt), but the goal bridge fails.
    advance(DAY);
    paidOrderObservationDeps.bridge = async () => {
      throw new Error("connection lost");
    };
    await t.importLedger([paysToday(BEA)], new Date());
    Object.assign(paidOrderObservationDeps, productionDeps);
    const beaOrder = await latestOrder(t.tenantId, BEA.customerId);
    expect(await loop.obligationOf(t.tenantId, beaOrder)).toMatchObject({ sourceKind: "cleancloud_paid_order", status: "pending", attemptCount: 1, lastError: "connection lost" });
    expect(await paidOutcomes(t.tenantId)).toEqual([]);
    expect(await readObservationBridgeBacklog({ tenantId: t.tenantId })).toMatchObject({ retrying: 1 });
    // The economic event is canonical already, whatever happens to its goal bridge.
    const revenue = await readCanonicalRevenue({ tenantId: t.tenantId, from: addDaysYmd(today(), -1), to: today(), timeZone: ZONE, now: new Date() });
    expect(revenue.status === "ok" && revenue.recordedCents).toBe(6100);

    // A restarted worker's sweep retries it from the persisted obligation; nothing is re-imported.
    const batches = await importBatches(t.tenantId);
    advance(5 * 60_000);
    const first = await sweepObservationBridges({ leaseOwner: "worker-after-restart", tenantId: t.tenantId });
    expect(first.errors).toEqual([]);
    expect(await loop.obligationOf(t.tenantId, beaOrder)).toMatchObject({ status: "bridged", attemptCount: 2 });
    let paid = await paidOutcomes(t.tenantId);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ objectiveId, monetaryValueCents: 6100, evidenceReference: `orders:cleancloud:${beaOrder}` });
    expect(json(paid[0]!.metadataJson).attribution).toMatchObject({ causal: false, identityKey: "cleancloud:c2" });
    expect(await importBatches(t.tenantId)).toBe(batches);

    // 2. Alma pays, and the process dies after the import commits: the post-import step never runs.
    paidOrderObservationDeps.afterImport = async () => ({ byStatus: {} });
    await t.importLedger([paysToday(ALMA)], new Date());
    Object.assign(paidOrderObservationDeps, productionDeps);
    const almaOrder = await latestOrder(t.tenantId, ALMA.customerId);
    expect(await loop.obligationOf(t.tenantId, almaOrder)).toBeUndefined();
    const reconciled = await sweepObservationBridges({ leaseOwner: "worker-after-restart", tenantId: t.tenantId });
    expect(reconciled.discovered).toBeGreaterThanOrEqual(1);
    expect(await loop.obligationOf(t.tenantId, almaOrder)).toMatchObject({ status: "bridged" });

    // 3. Dana pays (not targeted). A worker leases the obligation and dies before settling it.
    paidOrderObservationDeps.afterImport = async () => ({ byStatus: {} });
    await t.importLedger([paysToday(DANA)], new Date());
    Object.assign(paidOrderObservationDeps, productionDeps);
    const danaOrder = await latestOrder(t.tenantId, DANA.customerId);
    await sweepObservationBridges({ leaseOwner: "discovery-only", limit: 0, tenantId: t.tenantId });
    const [leased] = await claimDueObservationObligations({ leaseOwner: "dead-worker", leaseMs: 2 * 60_000, tenantId: t.tenantId, now: new Date() });
    expect(leased?.sourceKey).toBe(danaOrder);
    await sweepObservationBridges({ leaseOwner: "live-worker", tenantId: t.tenantId });
    expect(await loop.obligationOf(t.tenantId, danaOrder)).toMatchObject({ status: "pending", attemptCount: 0 });
    advance(3 * 60_000); // the dead worker's lease expires
    await sweepObservationBridges({ leaseOwner: "live-worker", tenantId: t.tenantId });
    expect(await loop.obligationOf(t.tenantId, danaOrder)).toMatchObject({ status: "unrelated", attemptCount: 1 });

    // 4. Orders arrive with no customer identity. Each waits as unresolved, never as unrelated.
    await t.importLedger([{ ...paysToday(BEA), customerId: "", total: "62.50" }, { ...paysToday(ALMA), customerId: "", total: "50.00" }], new Date());
    const anonymousBea = String((await loop.rows("SELECT cleancloudOrderId FROM cleancloud_paid_orders WHERE tenantId = ? AND customerName = ? AND totalCents = 6250", [t.tenantId, BEA.name]))[0]!.cleancloudOrderId);
    const anonymousAlma = String((await loop.rows("SELECT cleancloudOrderId FROM cleancloud_paid_orders WHERE tenantId = ? AND customerName = ? AND totalCents = 5000", [t.tenantId, ALMA.name]))[0]!.cleancloudOrderId);
    expect(await loop.obligationOf(t.tenantId, anonymousBea)).toMatchObject({ status: "unresolved_identity" });
    expect(await loop.obligationOf(t.tenantId, anonymousAlma)).toMatchObject({ status: "unresolved_identity" });
    // (a) A later export fills in Bea's customer id along with a corrected total: a new
    //     economic revision with its own admitted receipt. The retry re-reads it and attributes it.
    t.amendLedger(line => line[0] === anonymousBea, line => {
      line[3] = BEA.customerId;
      line[7] = "62.75";
      return line;
    });
    // (b) For Alma's order the export only fills in the customer id. With PR #643's
    //     fix, the paid-order ledger keeps the paid order counted (preserving its
    //     valid receipt by payment time rather than dropping it), and the goal side bridges it.
    t.amendLedger(line => line[0] === anonymousAlma, line => {
      line[3] = ALMA.customerId;
      return line;
    });
    await t.importLedger([], new Date());
    advance(31 * 60_000);
    await sweepObservationBridges({ leaseOwner: "live-worker", tenantId: t.tenantId });
    expect(await loop.obligationOf(t.tenantId, anonymousBea)).toMatchObject({ status: "bridged" });
    const almaCounted = await loop.obligationOf(t.tenantId, anonymousAlma);
    expect(almaCounted).toMatchObject({ status: "bridged" });

    // Every attributed order is one the ledger counts, once; retries never duplicated an order or an outcome.
    paid = await paidOutcomes(t.tenantId);
    expect(paid.map(o => o.evidenceReference).sort()).toEqual([anonymousAlma, anonymousBea, almaOrder, beaOrder].map(id => `orders:cleancloud:${id}`).sort());
    expect(paid.find(o => o.evidenceReference === `orders:cleancloud:${anonymousBea}`)).toMatchObject({ monetaryValueCents: 6275 });
    expect(paid.find(o => o.evidenceReference === `orders:cleancloud:${anonymousAlma}`)).toMatchObject({ monetaryValueCents: 5000 });
    const [duplicates] = await loop.rows("SELECT COUNT(*) AS n FROM (SELECT cleancloudOrderId FROM cleancloud_paid_orders WHERE tenantId = ? GROUP BY cleancloudOrderId, sourceReportType HAVING COUNT(*) > 1) d", [t.tenantId]);
    expect(Number(duplicates!.n)).toBe(0);
    const after = await readCanonicalRevenue({ tenantId: t.tenantId, from: addDaysYmd(today(), -1), to: today(), timeZone: ZONE, now: new Date() });
    expect(after.status === "ok" && after.recordedCents).toBe(6100 + 4800 + 3300 + 6275 + 5000);
    expect(await readObservationBridgeBacklog({ tenantId: t.tenantId })).toMatchObject({ retrying: 0, needsReview: 0 });
  }, 300_000);

  it("never guesses: two attempts that both own a customer go to review, an untargeted order is unrelated, unadmitted evidence is rejected", async () => {
    const { t, store } = await loop.tenant({ prefix: "d" });
    const silverLake = await loop.executeStrategyAttempt(t, store);
    expect(silverLake.completed.goalEvidence).toMatchObject({ status: "recorded" });
    // The operator turns to Echo Park, whose ZIP overlaps Silver Lake: its win-back also targets Bea.
    await t.focusOn("Maximize sales in Echo Park");
    advance(HOUR);
    const echoPark = await loop.executeStrategyAttempt(t, store);
    expect(echoPark.completed.goalEvidence).toMatchObject({ status: "recorded" });
    const silverObjective = silverLake.completed.goalEvidence!.objectiveId!;
    const echoObjective = echoPark.completed.goalEvidence!.objectiveId!;
    expect(echoObjective).not.toBe(silverObjective);
    expect(echoPark.completed.goalEvidence!.observation!.targets.map(target => target.identityKey)).toContain("cleancloud:c2");

    advance(DAY);
    await t.importLedger([paysToday(BEA), paysToday(CRUZ)], new Date());
    const beaOrder = await latestOrder(t.tenantId, BEA.customerId);
    const cruzOrder = await latestOrder(t.tenantId, CRUZ.customerId);
    const review = await loop.obligationOf(t.tenantId, beaOrder);
    expect(review).toMatchObject({ status: "ambiguous_review" });
    expect(json(review!.resultJson).candidateObjectiveIds.sort()).toEqual([silverObjective, echoObjective].sort());
    expect(await loop.obligationOf(t.tenantId, cruzOrder)).toMatchObject({ status: "unrelated" });
    expect(await paidOutcomes(t.tenantId)).toEqual([]);

    // An order row written without an admitted paid observation (an unadmitted legacy write) is not evidence.
    const legacyOrderId = `legacy-${Date.now()}`;
    await loop.rows(
      `INSERT INTO cleancloud_paid_orders
        (tenantId, sourceReportType, sourceFileName, importBatchId, cleancloudOrderId, cleancloudCustomerId, customerName, paid, totalCents, paymentDateUtc, buildingResolutionStatus)
       VALUES (?, 'orders_sales', 'legacy-unadmitted.csv', 0, ?, ?, ?, 1, 4800, ?, 'not_applicable')`,
      [t.tenantId, legacyOrderId, ALMA.customerId, ALMA.name, new Date()]
    );
    await sweepObservationBridges({ leaseOwner: "live-worker", tenantId: t.tenantId });
    expect(await loop.obligationOf(t.tenantId, legacyOrderId)).toMatchObject({ status: "rejected" });
    // The ledger does not count an unadmitted row, so the goal side never attributes it.
    expect(json((await loop.obligationOf(t.tenantId, legacyOrderId))!.resultJson).reason).toBe("payment_unverified_in_canonical_ledger");
    expect(await paidOutcomes(t.tenantId)).toEqual([]);

    // Settled classifications are final: a later sync and sweep never turn them into attribution.
    await t.importLedger([], new Date());
    await sweepObservationBridges({ leaseOwner: "live-worker", tenantId: t.tenantId });
    expect(await loop.obligationOf(t.tenantId, beaOrder)).toMatchObject({ status: "ambiguous_review" });
    expect(await paidOutcomes(t.tenantId)).toEqual([]);

    // The backlog signal shows what needs a person, through the operator's own diagnostics.
    const backlog = await persistentOperatorRouter
      .createCaller({ tenantId: t.tenantId, user: { id: t.userId, openId: t.openId, role: "user", name: "Op" }, req: undefined, res: undefined, vendorSession: null } as never)
      .observationBacklog();
    expect(backlog).toMatchObject({ needsReview: 1, retrying: 0 });
    expect(backlog!.byStatus).toMatchObject({ ambiguous_review: 1, rejected: 1 });
    expect(backlog!.attention.map(item => item.sourceKey)).toEqual([beaOrder]);
  }, 300_000);

  it("an order paid while its attempt's own evidence is still being recorded waits for it instead of being judged unrelated", async () => {
    const { t, store } = await loop.tenant({ prefix: "d" });
    await loop.runOccurrence(t, store);
    const approved = await loop.approveStrategy(t);
    at(approved.item.businessDate, "10:00:00");
    await t.importLedger([], new Date());
    // Completed through the Day Director control; its execution bridge fails and is pending.
    await t.dayDirector.complete({ commitmentId: approved.commitmentId });
    expect(
      await bridgeCommitmentCompletion(
        { tenantId: t.tenantId, commitmentId: approved.commitmentId, sourceSystem: "day_director", actorId: t.openId },
        { handler: async () => { throw new Error("objective store unavailable"); } }
      )
    ).toMatchObject({ status: "pending_retry" });

    // CleanCloud payment dates are days: a payment on the contact's own day cannot be ordered
    // after the contact, so the next day's payment is the one this attempt can claim.
    advance(DAY);
    await t.importLedger([paysToday(BEA)], new Date());
    const beaOrder = await latestOrder(t.tenantId, BEA.customerId);
    const waiting = await loop.obligationOf(t.tenantId, beaOrder);
    expect(waiting).toMatchObject({ status: "pending" });
    expect(json(waiting!.resultJson).reason).toBe("awaiting_attempt_lineage");

    // The sweep links the attempt first, then the order attaches to it.
    advance(5 * 60_000);
    await sweepObservationBridges({ leaseOwner: "live-worker", tenantId: t.tenantId });
    expect(await loop.obligationOf(t.tenantId, approved.commitmentId)).toMatchObject({ status: "bridged" });
    expect(await loop.obligationOf(t.tenantId, beaOrder)).toMatchObject({ status: "bridged" });
    const paid = await paidOutcomes(t.tenantId);
    expect(paid).toHaveLength(1);
    expect(json(paid[0]!.metadataJson).attribution).toMatchObject({ attemptCommitmentId: approved.commitmentId, causal: false });
  }, 300_000);
});
