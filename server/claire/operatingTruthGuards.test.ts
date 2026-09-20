import { describe, expect, it, vi } from "vitest";
import { answerClaireBusinessTurn, type ClaireBusinessTurnDeps } from "./businessConversation";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { loadPaidOrderLedger } from "../analytics/paidOrderLedger";
import { runBusinessQuery } from "../analytics/businessQuery";
import { emptyLoaders, fixtureLoaders } from "../analytics/businessLedgerFixture";
import { coverageVerdict, deriveCleanCloudEvidence, requiredSourcesFor, sourceHealthFor, type LedgerSourceEvidence, type SourceBindingState } from "../analytics/sourceBindings";

/**
 * The two invariants that broke the 2026-09-20 production call:
 *   1. an unqualified zero requires PROVEN source coverage, not merely a query that did not throw;
 *   2. the personal/biography (story) lane can never suppress an authoritative business fact.
 */

const NOW = new Date("2026-09-20T18:00:00Z");
const TZ = "America/Los_Angeles";
const ev = (
  cc: { state: SourceBindingState; lastSuccessAt?: Date | null },
  native: SourceBindingState = "bound"
): LedgerSourceEvidence => ({
  laundry_butler: { state: native, lastSuccessAt: NOW, isSystemOfRecord: true },
  cleancloud: { state: cc.state, lastSuccessAt: cc.lastSuccessAt === undefined ? NOW : cc.lastSuccessAt, isSystemOfRecord: false },
});
const bound = ev({ state: "bound" });
const unbound = ev({ state: "absent" }, "absent");
const unknown = ev({ state: "unknown" }, "unknown");
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

// ── Source health: "had data once" is not "sees the whole business now" ──────────────────────
describe("source health and freshness", () => {
  const loaded = ["laundry_butler", "cleancloud"] as const;
  const verdict = (evidence: LedgerSourceEvidence, period?: { endExclusiveUtc: Date }) =>
    coverageVerdict({ required: requiredSourcesFor(null), evidence, loadedSources: loaded, failedSources: [], period, now: NOW });

  it("connected + fresh + complete → a whole-business total is allowed", () => {
    expect(verdict(ev({ state: "bound", lastSuccessAt: NOW }))).toEqual({ kind: "provable" });
  });

  it("connected but STALE → not presented as a current whole-business total", () => {
    expect(verdict(ev({ state: "bound", lastSuccessAt: STALE_SINCE }))).toMatchObject({ kind: "stale", sources: ["cleancloud"] });
  });

  it("configured but never connected → not treated as connected", () => {
    expect(verdict(ev({ state: "configured" }))).toMatchObject({ kind: "unbound", sources: ["cleancloud"] });
  });

  it("historical rows with no live integration → belongs to the business, currentness NOT assumed", () => {
    const legacy = ev({ state: "legacy_history", lastSuccessAt: null });
    // It counts as present (so a real zero stays possible for pre-SaaS tenants)...
    expect(verdict(legacy)).not.toMatchObject({ kind: "unbound" });
    // ...but it is never silently treated as current.
    expect(verdict(legacy)).toMatchObject({ kind: "stale" });
  });

  it("browser-sync binding + recent success + zero rows in the period → a true zero is allowed", async () => {
    const turn = await ask("What was revenue in the last 30 days?", ev({ state: "bound", lastSuccessAt: NOW }));
    expect(turn.handled ? turn.speak : "").toMatch(ZERO_CLAIM);
  });

  it("one current source + one stale source + a real figure → partial total only", async () => {
    const turn = await ask("What was revenue this year?", ev({ state: "bound", lastSuccessAt: STALE_SINCE }), fixtureLoaders());
    const speak = turn.handled ? turn.speak : "";
    expect(speak).toMatch(/\$/);
    expect(speak).toMatch(/can't verify CleanCloud is current|isn't a confirmed whole-business total/i);
  });

  it("a CLOSED past period only needs a sync after that window closed", () => {
    const august = { endExclusiveUtc: new Date("2026-09-01T00:00:00Z") };
    const syncedInSeptember = ev({ state: "bound", lastSuccessAt: new Date("2026-09-02T00:00:00Z") });
    expect(verdict(syncedInSeptember, august)).toEqual({ kind: "provable" });
    // ...but the same feed is stale for a question that runs up to now.
    expect(verdict(syncedInSeptember)).toMatchObject({ kind: "stale" });
  });

  it("native Goldline orders are the system of record and are never 'stale'", () => {
    expect(sourceHealthFor({ state: "bound", lastSuccessAt: STALE_SINCE, isSystemOfRecord: true }, null, NOW)).toBe("not_applicable");
  });
});

describe("CleanCloud evidence hierarchy (precedence, not a database)", () => {
  const none = { syncBinding: null, saasConnection: null, importSuccessAt: null, historyAt: null };

  it("a browser-sync binding is the strongest signal and carries its lastSuccessAt", () => {
    expect(deriveCleanCloudEvidence({ ...none, syncBinding: { lastSuccessAt: NOW }, historyAt: STALE_SINCE }))
      .toMatchObject({ state: "bound", lastSuccessAt: NOW });
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

  it("history alone is legacy_history, never a live feed", () => {
    expect(deriveCleanCloudEvidence({ ...none, historyAt: STALE_SINCE })).toMatchObject({ state: "legacy_history" });
  });

  it("no evidence of any kind is absent", () => {
    expect(deriveCleanCloudEvidence(none)).toMatchObject({ state: "absent" });
  });

  it("import-batch success supplies freshness when the binding has none", () => {
    expect(deriveCleanCloudEvidence({ ...none, syncBinding: { lastSuccessAt: null }, importSuccessAt: NOW }))
      .toMatchObject({ state: "bound", lastSuccessAt: NOW });
  });
});
