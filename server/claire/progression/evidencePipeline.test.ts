import { describe, expect, it } from "vitest";
import { DAY1_TARGETS, type Day1TenDoorsPayload } from "../../../shared/day1TenDoors";
import type { Day1EvidencePayloadExtension, Day1VisitEvidence } from "../../../shared/day1Evidence";
import { applyProgressionBackfill, formatBackfillReport, planProgressionBackfill, type BackfillCandidate, type BackfillSources } from "./backfill";
import { deriveCommercialVisitEvidence, deriveDay1VisitEvidence } from "./fieldEvidence";
import { summarizeProgressionStatus } from "./status";
import { createInMemoryProgressionStore } from "./store";

const scope = { tenantId: "default", operatorUserId: "adam-admin" };
const oct = (day: number, hour = 18) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();

type Payload = Day1TenDoorsPayload & Day1EvidencePayloadExtension;
const visit = (targetId: string, patch: Partial<Day1VisitEvidence>): Day1VisitEvidence => ({
  targetId, arrivalRecordedAt: null, arrivalSource: null, lat: null, lng: null, accuracyMeters: null,
  outcomeRecordedAt: null, outcomeSource: null, outcome: null, decisionMaker: null, followUpNeeded: null, ...patch,
});
function day1(entries: Array<{ target: number; outcome: "pitched" | "couldnt_reach"; recordedAt?: string; arrivedAt?: string; source?: Day1VisitEvidence["outcomeSource"] }>): Payload {
  const outcomes: Payload["outcomes"] = {};
  const visitEvidence: NonNullable<Payload["visitEvidence"]> = {};
  for (const entry of entries) {
    const id = DAY1_TARGETS[entry.target]!.id;
    outcomes[id] = entry.outcome;
    if (entry.recordedAt || entry.arrivedAt) {
      visitEvidence[id] = visit(id, {
        outcome: entry.outcome, outcomeRecordedAt: entry.recordedAt ?? null, outcomeSource: entry.source ?? "operator_confirmed",
        arrivalRecordedAt: entry.arrivedAt ?? null, arrivalSource: entry.arrivedAt ? "gps" : null,
      });
    }
  }
  return { kind: "day1_ten_doors", targets: [...DAY1_TARGETS], outcomes, evidenceEvents: [], visitEvidence };
}

const customer = (n: number, day: number): BackfillCandidate => ({
  category: "business_progress", kind: "new_paying_customer", sourceType: "customer_order_truth", sourceId: `laundry_butler:${700 + n}`,
  provenance: "laundry_butler_order", occurredAt: oct(day, 15), recognizedAt: oct(day, 15), origin: "customer_order_truth",
});
/** October's non-currency facts, offered to the backfill exactly as a careless feed would. Validation must refuse them. */
const octoberNoise: BackfillCandidate[] = [
  ...Array.from({ length: 10 }, (_, i): BackfillCandidate => ({
    category: "growth_action", kind: "call_completed", sourceType: "claire_conversation", sourceId: `call-${i}`,
    provenance: "scheduled_call", occurredAt: oct(5 + i, 14), recognizedAt: oct(5 + i, 14), origin: "noise",
  })),
  {
    category: "growth_action", kind: "plan_created", sourceType: "strategic_proposal", sourceId: "proposal-1017",
    provenance: "approved_on_call", occurredAt: oct(17), recognizedAt: oct(17), origin: "noise",
  },
];
const fromDay1 = (payload: Payload): BackfillSources => {
  const derived = deriveDay1VisitEvidence({ payload });
  return {
    candidates: derived.evidence.map(item => ({ ...item, origin: "day1:operator" })),
    skipped: derived.skipped.map(item => ({ ...item, origin: "day1:operator" })),
    aliasHeldEvidence: [],
  };
};
const deps = (store = createInMemoryProgressionStore(), sources: BackfillSources) => ({
  store,
  loadSources: async () => sources,
  loadDisclosureSafetyOk: async () => false,
  now: () => new Date(oct(21)),
});

describe("field evidence derivation (Day 1 Ten Doors)", () => {
  it("credits a recorded pitch at its recorded time, one identity per door", () => {
    const { evidence, skipped } = deriveDay1VisitEvidence({ payload: day1([{ target: 0, outcome: "pitched", recordedAt: oct(3) }]) });
    expect(skipped).toEqual([]);
    expect(evidence).toEqual([
      expect.objectContaining({
        category: "growth_action", kind: "confirmed_field_visit", sourceType: "day1_ten_doors",
        sourceId: DAY1_TARGETS[0]!.id, occurredAt: oct(3), recognizedAt: oct(3),
      }),
    ]);
  });

  it("never guesses: legacy outcomes without a time, couldn't-reach without arrival and backfills without arrival are skipped", () => {
    const { evidence, skipped } = deriveDay1VisitEvidence({
      payload: day1([
        { target: 0, outcome: "pitched" },
        { target: 1, outcome: "couldnt_reach", recordedAt: oct(3) },
        { target: 2, outcome: "pitched", recordedAt: oct(20), source: "operator_backfill" },
        { target: 3, outcome: "couldnt_reach", recordedAt: oct(4, 19), arrivedAt: oct(4, 18) },
        { target: 4, outcome: "pitched", recordedAt: oct(20), source: "operator_backfill", arrivedAt: oct(6) },
      ]),
    });
    expect(skipped.map(item => item.sourceId)).toEqual([DAY1_TARGETS[0]!.id, DAY1_TARGETS[1]!.id, DAY1_TARGETS[2]!.id]);
    // couldn't-reach with a recorded arrival is a real visit, dated by the arrival; a backfill is dated by arrival, not by "now".
    expect(evidence.map(item => [item.sourceId, item.occurredAt])).toEqual([
      [DAY1_TARGETS[3]!.id, oct(4, 18)],
      [DAY1_TARGETS[4]!.id, oct(6)],
    ]);
  });

  it("commercial visit outcomes reuse recordConfirmedVisitEvidence identities; only a win is progress", () => {
    const { evidence } = deriveCommercialVisitEvidence([
      { missionId: 7, outcome: "lost", recordedAt: new Date(oct(2)) },
      { missionId: 8, outcome: "won", recordedAt: new Date(oct(3)) },
    ]);
    expect(evidence.map(item => `${item.category}:${item.kind}:${item.sourceType}:${item.sourceId}`)).toEqual([
      "growth_action:confirmed_field_visit:commercial_mission:7",
      "growth_action:confirmed_field_visit:commercial_mission:8",
      "business_progress:target_account_won:commercial_mission:8",
    ]);
  });
});

describe("October replay against policy.ts thresholds (in memory)", () => {
  it("October as it happened (3 pitches on 3 days, 2 new customers, 10 calls, 1 approved proposal) earns band 1 and no rung", async () => {
    const sources = fromDay1(day1([
      { target: 0, outcome: "pitched", recordedAt: oct(3) },
      { target: 1, outcome: "pitched", recordedAt: oct(8) },
      { target: 2, outcome: "pitched", recordedAt: oct(14) },
    ]));
    sources.candidates.push(customer(1, 10), customer(2, 18), ...octoberNoise);
    const plan = await planProgressionBackfill(scope, deps(undefined, sources));
    expect(plan.rows.filter(row => row.action === "rejected").map(row => row.kind).sort()).toEqual([
      ...Array(10).fill("call_completed"), "plan_created",
    ]);
    expect(plan.after.counts).toEqual({ growthActions: 3, growthActionDays: 3, progressEvents: 2, strongResults: 2 });
    expect(plan.after.grant.rapportBand).toBe(1);
    // Rung 1 needs 5 actions on 3 days: three doors are two short. Thresholds stay as they are.
    expect(plan.after.grant.personalRung).toBe(0);
    expect(plan.after.entitlementsMinted).toBe(0);
  });

  it("the remaining two doors recorded on a fourth day reach rung 1 and mint exactly one entitlement", async () => {
    const sources = fromDay1(day1([
      { target: 0, outcome: "pitched", recordedAt: oct(3) },
      { target: 1, outcome: "pitched", recordedAt: oct(8) },
      { target: 2, outcome: "pitched", recordedAt: oct(14) },
      { target: 3, outcome: "pitched", recordedAt: oct(20) },
      { target: 4, outcome: "pitched", recordedAt: oct(20, 19) },
    ]));
    sources.candidates.push(customer(1, 10), customer(2, 18), ...octoberNoise);
    const plan = await planProgressionBackfill(scope, deps(undefined, sources));
    expect(plan.after.grant).toMatchObject({ rapportBand: 1, personalRung: 1 });
    // No backlog: two qualifying customers, ONE initial entitlement.
    expect(plan.after.entitlementsMinted).toBe(1);
  });

  it("dry-run writes nothing; apply is idempotent and never lowers a grant", async () => {
    const store = createInMemoryProgressionStore();
    const sources = fromDay1(day1([
      { target: 0, outcome: "pitched", recordedAt: oct(3) },
      { target: 1, outcome: "pitched", recordedAt: oct(8) },
      { target: 2, outcome: "pitched", recordedAt: oct(14) },
    ]));
    await planProgressionBackfill(scope, deps(store, sources));
    expect(await store.listEvidence(scope)).toEqual([]);
    expect(await store.getGrant(scope)).toBeNull();

    const first = await applyProgressionBackfill(scope, deps(store, sources));
    expect(first.created).toBe(3);
    expect(first.grant.rapportBand).toBe(1);
    const second = await applyProgressionBackfill(scope, deps(store, sources));
    expect(second.created).toBe(0);
    expect(second.plan.rows.every(row => row.action === "already_held")).toBe(true);
    expect(second.grant).toEqual(first.grant);
    expect(second.mintedEntitlementIds).toEqual([]);
  });

  it("formats the dry-run report Adam reads", async () => {
    const sources = fromDay1(day1([
      { target: 0, outcome: "pitched", recordedAt: oct(3) },
      { target: 1, outcome: "pitched" },
    ]));
    sources.candidates.push(customer(1, 10));
    sources.unclaimedDay1DriverIds = ["1", "driver-primary"];
    const report = formatBackfillReport(await planProgressionBackfill(scope, deps(undefined, sources)), "dry-run");
    expect(report).toContain("Claire progression backfill — DRY-RUN");
    expect(report).toContain("WOULD MINT (2)");
    expect(report).toContain("legacy outcome without a recorded time");
    expect(report).toContain("UNCLAIMED DAY 1 DRIVER IDS");
    expect(report).toMatch(/before: band 0, rung 0/);
    expect(report).toMatch(/next band 1: needs 3 actions on 2 days/);
  });
});

describe("admin progression status (read-only summary)", () => {
  it("counts evidence by kind, lists newest first and states the distance to the next band and rung", () => {
    const evidence = [
      { ...scope, id: "1", category: "growth_action" as const, kind: "follow_up_done", strength: null, sourceType: "commercial_follow_up", sourceId: "f1", provenance: "x", occurredAt: "2026-08-07T18:00:00.000Z", recognizedAt: "2026-08-07T18:00:00.000Z" },
      { ...scope, id: "2", category: "business_progress" as const, kind: "new_paying_customer", strength: "strong" as const, sourceType: "customer_order_truth", sourceId: "laundry_butler:707", provenance: "laundry_butler_order", occurredAt: oct(18), recognizedAt: oct(18) },
    ];
    const status = summarizeProgressionStatus({ scope, evidence, grant: null, entitlements: [], asOf: new Date(oct(21)) });
    expect(status.grant).toMatchObject({ rapportBand: 0, personalRung: 0 });
    expect(status.evidenceByKind).toEqual([
      { category: "growth_action", kind: "follow_up_done", rows: 1 },
      { category: "business_progress", kind: "new_paying_customer", rows: 1 },
    ]);
    expect(status.lastEvidence.map(row => row.id)).toEqual(["2", "1"]);
    expect(status.nextBand).toEqual({ target: 1, needs: ["2 more growth actions", "1 more distinct action days"] });
    expect(status.nextRung?.needs).toEqual(["4 more growth actions", "2 more distinct action days"]);
  });
});
