import { describe, expect, it, vi } from "vitest";
import { answerClaireBusinessTurn, type ClaireBusinessTurnDeps } from "./businessConversation";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { loadPaidOrderLedger } from "../analytics/paidOrderLedger";
import { runBusinessQuery } from "../analytics/businessQuery";
import { emptyLoaders, fixtureLoaders } from "../analytics/businessLedgerFixture";
import {
  coverageVerdict,
  deriveCleanCloudEvidence,
  expectedCleanCloudCoverageThrough,
  rangesCover,
  requiredSourcesFor,
  type LedgerSourceEvidence,
  type SourceBindingState,
  type SourceCoverageBasis,
  type SourceCoverageRange,
} from "../analytics/sourceBindings";

/**
 * The two invariants that broke the 2026-09-20 production call:
 *   1. an unqualified zero requires PROVEN source coverage, not merely a query that did not throw;
 *   2. the personal/biography (story) lane can never suppress an authoritative business fact.
 */

const NOW = new Date("2026-09-20T18:00:00Z"); // 11:00 AM Pacific — before today's 6 PM checkpoint.
const AFTER_DUE = new Date("2026-09-21T02:15:00Z"); // 7:15 PM Pacific — after the one-hour grace.
const TZ = "America/Los_Angeles";
const fullRange = (
  basis: SourceCoverageBasis = "economic_event",
  from = "2020-01-01",
  to = "2099-12-31",
  completedAt = NOW
): SourceCoverageRange => ({
  from,
  to,
  completedAt,
  basis,
  provenance: "browser_sync_receipt",
});
const ev = (
  cc: {
    state: SourceBindingState;
    lastSuccessAt?: Date | null;
    coverageRanges?: SourceCoverageRange[];
    latestAttempt?: { at: Date; outcome: string; rangeFrom: string | null; rangeTo: string | null } | null;
  },
  native: SourceBindingState = "bound"
): LedgerSourceEvidence => ({
  laundry_butler: {
    state: native,
    lastSuccessAt: NOW,
    coverageRanges: [],
    latestAttempt: null,
    isSystemOfRecord: true,
  },
  cleancloud: {
    state: cc.state,
    lastSuccessAt: cc.lastSuccessAt === undefined ? NOW : cc.lastSuccessAt,
    coverageRanges: cc.coverageRanges ?? [fullRange()],
    latestAttempt: cc.latestAttempt ?? null,
    isSystemOfRecord: false,
  },
});
const bound = ev({ state: "bound" });
const unbound = ev({ state: "absent", coverageRanges: [] }, "absent");
const unknown = ev({ state: "unknown", coverageRanges: [] }, "unknown");
const STALE_SINCE = new Date("2026-06-01T00:00:00Z");

function turnDeps(bindings: LedgerSourceEvidence, loaders = emptyLoaders): Partial<ClaireBusinessTurnDeps> {
  return {
    now: () => NOW,
    timeZone: () => TZ,
    plan: vi.fn(async () => null) as never,
    loadBindings: async () => bindings,
    runQuery: (tenantId, query) =>
      runBusinessQuery(tenantId, query, {
        loadLedger: input => loadPaidOrderLedger(input, loaders),
        loadOpenOrders: async () => ({ openTotal: 0, byStatus: {}, awaitingPayment: 0 }) as never,
        loadCompleteness: async () => ({ missing: [] }) as never,
        now: () => NOW,
        timeZone: () => TZ,
      }),
  };
}

const ask = (utterance: string, bindings: LedgerSourceEvidence, loaders = emptyLoaders) =>
  answerClaireBusinessTurn({ tenantId: "t1", utterance, state: {}, surface: "voice" }, turnDeps(bindings, loaders));

const ZERO_CLAIM = /\$0\.00|\b0 orders\b|\bno paid (?:orders|revenue)\b|\bzero (?:orders|revenue|customers)\b/i;

describe("zero requires positive proof", () => {
  it("REPRODUCTION: the empty tenant that told Adam '$0.00 across 0 orders' can no longer say it", async () => {
    // Exactly the production shape: both loaders succeed, no rows, so completeness is "complete".
    const turn = await ask("What was revenue in the last 30 days?", unbound);
    expect(turn.handled).toBe(true);
    const speak = turn.handled ? turn.speak : "";
    expect(speak).not.toMatch(ZERO_CLAIM);
    expect(speak).toMatch(/aren't connected|isn't connected/i);
    expect(speak).toMatch(/not a zero/i);
  });

  it("a genuinely empty period on a connected business still speaks a real zero", async () => {
    const turn = await ask("What was revenue in the last 30 days?", bound);
    const speak = turn.handled ? turn.speak : "";
    expect(speak).toMatch(ZERO_CLAIM);
  });

  it("A REAL BUT PARTIAL TOTAL cannot pass as the whole business", async () => {
    // The $0 bug's quieter twin: a true number from one source, reported as if it were everything.
    const turn = await ask("What was revenue this year?", ev({ state: "absent" }), fixtureLoaders());
    const speak = turn.handled ? turn.speak : "";
    expect(speak).toMatch(/\$/); // the verified figure is still spoken
    expect(speak).toMatch(/partial|not the whole business/i); // but its scope is stated
  });

  it("a fully covered non-empty total carries no caveat", async () => {
    const turn = await ask("What was revenue this year?", bound, fixtureLoaders());
    const speak = turn.handled ? turn.speak : "";
    expect(speak).not.toMatch(/partial|not the whole business/i);
  });

  it("bindings that cannot be established do not license a zero either", async () => {
    const speak = (await ask("What was revenue in the last 30 days?", unknown)) as { speak?: string };
    expect(speak.speak ?? "").not.toMatch(ZERO_CLAIM);
    expect(speak.speak ?? "").toMatch(/can't confirm/i);
  });

  it("applies to order counts and customer counts, not just revenue", async () => {
    for (const question of ["How many orders were there in the last 30 days?", "How many active customers are there?"]) {
      const turn = await ask(question, unbound);
      const speak = turn.handled ? turn.speak : "";
      expect(speak).not.toMatch(ZERO_CLAIM);
    }
  });
});

describe("coverage is question-relative", () => {
  it("a whole-business question needs every source; a scoped one needs only its own", () => {
    expect(requiredSourcesFor(null)).toEqual(["laundry_butler", "cleancloud"]);
    expect(requiredSourcesFor(["cleancloud"])).toEqual(["cleancloud"]);
  });

  it("an unbound source only blocks a zero when the question actually needs it", () => {
    const partial = ev({ state: "absent" });
    const loaded = ["laundry_butler", "cleancloud"] as const;
    expect(coverageVerdict({ required: ["laundry_butler"], evidence: partial, loadedSources: loaded, failedSources: [], now: NOW })).toEqual({ kind: "provable" });
    expect(coverageVerdict({ required: requiredSourcesFor(null), evidence: partial, loadedSources: loaded, failedSources: [], now: NOW })).toMatchObject({ kind: "unbound" });
  });

  it("a source that failed to load blocks a zero even when it is bound", () => {
    expect(
      coverageVerdict({ required: requiredSourcesFor(null), evidence: bound, loadedSources: ["laundry_butler"], failedSources: ["cleancloud"], now: NOW })
    ).toMatchObject({ kind: "unreadable", sources: ["cleancloud"] });
  });
});

// ── Story / business firewall ────────────────────────────────────────────────────────────────
const context = { businessDate: "2026-09-20", actorId: "adam-admin", macroGoalKnown: false, blockers: [], relevantTimeline: [], mission: null } as never;
const REVENUE = "Paid revenue in the last 30 days is $2,314.42 across 18 orders.";
const evidence = [{ source: "business_reader:query", text: REVENUE }];

async function follow(utterance: string, generated: string, opts: { verifier?: () => Promise<boolean> | never; withEvidence?: boolean } = {}) {
  const invokeText = vi.fn().mockResolvedValue(generated);
  return answerClairePreDriveFollowUp(
    { tenantId: "t1", utterance, brief: "b", context, conversationId: "c1", ...(opts.withEvidence === false ? {} : { retrievedEvidence: evidence }) },
    {
      invokeText,
      recordGeneration: vi.fn().mockResolvedValue(undefined),
      biographyVerifier: (opts.verifier ?? (async () => true)) as never,
    }
  );
}

describe("the story lane can never suppress a business fact", () => {
  const failures: Array<[string, () => Promise<boolean>]> = [
    ["verifier times out / errors", async () => { throw new Error("timeout"); }],
    ["verifier returns a false BIOGRAPHY verdict", async () => false],
  ];

  it.each(failures)("business-only turn survives when the %s", async (_label, verifier) => {
    const spoken = await follow("What did I make the last 30 days?", REVENUE, { verifier });
    expect(spoken).toMatch(/2,314\.42/);
    expect(spoken).not.toMatch(/Give me a second|don't have a record/i);
  });

  it("MIXED turn: the business half survives and only the personal half is declined", async () => {
    const spoken = await follow(
      "What did I make the last 30 days, and what did you do this weekend?",
      `${REVENUE} I spent Sunday walking the canal.`,
      { verifier: async () => false }
    );
    expect(spoken).toMatch(/2,314\.42/); // business fact preserved
    expect(spoken).not.toMatch(/canal|Sunday/i); // invented biography removed
  });

  it("a business fact is identical with progression ON and OFF", async () => {
    const results: string[] = [];
    for (const setting of [undefined, "some-other-tenant"]) {
      if (setting) process.env.CLAIRE_PROGRESSION = setting;
      else delete process.env.CLAIRE_PROGRESSION;
      try {
        results.push(await follow("What did I make the last 30 days?", REVENUE, { verifier: async () => false }));
      } finally {
        delete process.env.CLAIRE_PROGRESSION;
      }
    }
    expect(results[0]).toMatch(/2,314\.42/);
    expect(results[1]).toMatch(/2,314\.42/);
  });

  it("invented biography is still blocked when there is no business fact to protect", async () => {
    const spoken = await follow("What should I lead with at The Louise?", "Lead with the pilot. Cairo taught me to travel light.", {
      verifier: async () => false,
      withEvidence: false,
    });
    expect(spoken).not.toMatch(/Cairo/i);
  });
});

// ── Authorized call destination ──────────────────────────────────────────────────────────────
describe("a real phone is only dialed for a real operator of that tenant", () => {
  it("REPRODUCTION: the synthetic acceptance identity that rang Adam's phone is now refused", async () => {
    const { authorizedOperatorPhone } = await import("./claireTwilio");
    vi.doMock("../db", () => ({ getUserByOpenId: async () => undefined }));
    await expect(
      authorizedOperatorPhone({ tenantId: "zz-slice0-accept-2", actorId: "slice0-adam" })
    ).rejects.toThrow(/no such operator|not configured/i);
  });
});

// ── Source health + exact range coverage ──────────────────────────────────────────────────────
describe("source health and exact range coverage", () => {
  const loaded = ["laundry_butler", "cleancloud"] as const;
  const verdict = (
    evidence: LedgerSourceEvidence,
    period: { start: string; end: string },
    now = NOW,
    basis: SourceCoverageBasis = "economic_event"
  ) =>
    coverageVerdict({
      required: requiredSourcesFor(null),
      evidence,
      loadedSources: loaded,
      failedSources: [],
      period,
      now,
      basis,
    });

  it("August query + September 2 receipt covering September 2 only does NOT prove August", () => {
    const evidence = ev({
      state: "bound",
      coverageRanges: [fullRange("orders_created", "2026-09-02", "2026-09-02", new Date("2026-09-02T23:00:00Z"))],
    });
    expect(verdict(evidence, { start: "2026-08-01", end: "2026-08-31" }, NOW, "orders_created"))
      .toMatchObject({ kind: "range_gap", sources: ["cleancloud"] });
  });

  it("August query + a receipt explicitly covering August 1-31 proves that SELECTED Orders (Sales) range", () => {
    const evidence = ev({
      state: "bound",
      coverageRanges: [fullRange("orders_created", "2026-08-01", "2026-08-31", new Date("2026-09-01T02:00:00Z"))],
    });
    expect(verdict(evidence, { start: "2026-08-01", end: "2026-08-31" }, NOW, "orders_created"))
      .toEqual({ kind: "provable" });
  });

  it("contiguous daily receipts span a requested interval without a gap", () => {
    const ranges = ["01", "02", "03", "04"].map(day =>
      fullRange("orders_created", `2026-08-${day}`, `2026-08-${day}`)
    );
    expect(rangesCover(ranges, { from: "2026-08-01", to: "2026-08-04", basis: "orders_created" })).toBe(true);
    const evidence = ev({ state: "bound", coverageRanges: ranges });
    expect(verdict(evidence, { start: "2026-08-01", end: "2026-08-04" }, NOW, "orders_created"))
      .toEqual({ kind: "provable" });
  });

  it("a gap inside the requested interval stays partial", () => {
    const evidence = ev({
      state: "bound",
      coverageRanges: [
        fullRange("orders_created", "2026-08-01", "2026-08-02"),
        fullRange("orders_created", "2026-08-04", "2026-08-04"),
      ],
    });
    expect(verdict(evidence, { start: "2026-08-01", end: "2026-08-04" }, NOW, "orders_created"))
      .toMatchObject({ kind: "range_gap", sources: ["cleancloud"] });
  });

  it("before today's 6 PM run + grace, yesterday is the current expected checkpoint", () => {
    expect(expectedCleanCloudCoverageThrough(NOW)).toBe("2026-09-19");
    const evidence = ev({
      state: "bound",
      coverageRanges: [fullRange("orders_created", "2026-09-19", "2026-09-19")],
    });
    expect(verdict(evidence, { start: "2026-09-19", end: "2026-09-20" }, NOW, "orders_created"))
      .toEqual({ kind: "provable" });
  });

  it("after today's scheduled run plus grace, missing today's receipt is stale", () => {
    expect(expectedCleanCloudCoverageThrough(AFTER_DUE)).toBe("2026-09-20");
    const evidence = ev({
      state: "bound",
      coverageRanges: [fullRange("orders_created", "2026-09-19", "2026-09-19")],
    });
    expect(verdict(evidence, { start: "2026-09-19", end: "2026-09-20" }, AFTER_DUE, "orders_created"))
      .toMatchObject({ kind: "stale", sources: ["cleancloud"] });
  });

  it("a recent success timestamp for an unrelated range cannot freshen the requested period", () => {
    const evidence = ev({
      state: "bound",
      lastSuccessAt: NOW,
      coverageRanges: [fullRange("orders_created", "2026-09-02", "2026-09-02", NOW)],
    });
    expect(verdict(evidence, { start: "2026-08-01", end: "2026-08-31" }, NOW, "orders_created"))
      .toMatchObject({ kind: "range_gap", sources: ["cleancloud"] });
  });

  it("a failed latest scheduled attempt with no due-range success forbids a current whole-business total", () => {
    const evidence = ev({
      state: "bound",
      coverageRanges: [fullRange("orders_created", "2026-09-19", "2026-09-19")],
      latestAttempt: {
        at: new Date("2026-09-21T01:05:00Z"),
        outcome: "extension_import",
        rangeFrom: "2026-09-20",
        rangeTo: "2026-09-20",
      },
    });
    expect(verdict(evidence, { start: "2026-09-19", end: "2026-09-20" }, AFTER_DUE, "orders_created"))
      .toMatchObject({ kind: "stale", sources: ["cleancloud"] });
  });

  it("browser Orders (Sales) range coverage does not masquerade as payment-event completeness", () => {
    const evidence = ev({
      state: "bound",
      coverageRanges: [fullRange("orders_created", "2026-08-01", "2026-08-31")],
    });
    expect(verdict(evidence, { start: "2026-08-01", end: "2026-08-31" }, NOW, "economic_event"))
      .toMatchObject({ kind: "semantic_gap", sources: ["cleancloud"] });
  });

  it("one system-of-record source plus CleanCloud semantic gap yields a partial spoken total", async () => {
    const evidence = ev({
      state: "bound",
      coverageRanges: [fullRange("orders_created", "2026-01-01", "2026-09-19")],
    });
    const turn = await ask("What was revenue this year?", evidence, fixtureLoaders());
    const speak = turn.handled ? turn.speak : "";
    expect(speak).toMatch(/\$/);
    expect(speak).toMatch(/order date|payment events|exhaustive whole-business coverage/i);
  });
});

describe("CleanCloud evidence hierarchy (precedence, not a database)", () => {
  const none = {
    syncBinding: null,
    saasConnection: null,
    historyAt: null,
    coverageRanges: [] as SourceCoverageRange[],
    latestAttempt: null,
  };

  it("a browser-sync binding is the strongest membership signal and carries receipt success separately", () => {
    const range = fullRange("orders_created", "2026-09-19", "2026-09-19", NOW);
    expect(deriveCleanCloudEvidence({
      ...none,
      syncBinding: { lastSuccessAt: NOW },
      historyAt: STALE_SINCE,
      coverageRanges: [range],
    })).toMatchObject({
      state: "bound",
      lastSuccessAt: NOW,
      coverageRanges: [range],
    });
  });

  it("status 'configured' is NOT promoted to connected", () => {
    expect(deriveCleanCloudEvidence({ ...none, saasConnection: { status: "configured", lastImportedAt: null } }))
      .toMatchObject({ state: "configured" });
    expect(deriveCleanCloudEvidence({ ...none, saasConnection: { status: "connected", lastImportedAt: NOW } }))
      .toMatchObject({ state: "bound" });
  });

  it("a disabled or erroring integration is disconnected even with history", () => {
    for (const status of ["disabled", "error"]) {
      expect(deriveCleanCloudEvidence({ ...none, saasConnection: { status, lastImportedAt: null }, historyAt: NOW }))
        .toMatchObject({ state: "disconnected" });
    }
  });

  it("history alone is legacy_history, never a live feed and never fabricated range coverage", () => {
    expect(deriveCleanCloudEvidence({ ...none, historyAt: STALE_SINCE }))
      .toMatchObject({ state: "legacy_history", coverageRanges: [] });
  });

  it("no evidence of any kind is absent", () => {
    expect(deriveCleanCloudEvidence(none)).toMatchObject({ state: "absent" });
  });
});
