import { describe, expect, it, vi } from "vitest";
import type { BusinessMemoryDeps } from "../businessMemory/adapter";
import type { FactualClaimReceipt, PriorClaimVerification } from "../../provenance/claimReceipts";
import { observeShadowTurn, type ShadowRetrievalContext } from "../shadow/observeShadowTurn";
import { createInMemoryShadowMemoryStore } from "../shadow/shadowMemory";
import { readOnlyWorkingMemorySource } from "../shadow/v1Snapshot";

const ON = { CLAIRE_BRAIN_V2_SHADOW: "1" } as unknown as NodeJS.ProcessEnv;

const receipt: FactualClaimReceipt = {
  id: "receipt-1",
  conversationKey: "claire-call:real-path",
  claireTurnOrdinal: 1,
  claimedAtMs: 1,
  claimType: "paid_revenue",
  answerText: "Revenue was $4,200.",
  grounding: "deterministic",
  answerPath: "business",
  reader: "runBusinessQuery",
  metric: "revenue",
  periodLabel: "last 30 days",
  evidence: [{ source: "paid_order_ledger", ref: "event-1" }],
  fingerprint: "before",
  newestRecordAt: null,
  asOf: "2026-09-20",
  freshness: null,
  recheck: { kind: "business_query", query: {} as never },
};

const live: ShadowRetrievalContext = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  conversationId: "real-path",
  dayDirectorActorId: "42",
  businessDate: "2026-09-20",
  timeZone: "America/Los_Angeles",
  surface: "voice",
  priorClaimReceipts: [receipt],
};

function deps(overrides: Partial<BusinessMemoryDeps>): BusinessMemoryDeps {
  const unexpected = async () => {
    throw new Error("unexpected reader");
  };
  return {
    runQuery: unexpected,
    listAccounts: unexpected,
    listContacts: unexpected,
    loadHistory: unexpected,
    loadOpenOrders: unexpected,
    loadOperations: unexpected,
    verifyClaim: unexpected,
    ...overrides,
  } as BusinessMemoryDeps;
}

function observe(
  rawText: string,
  business: BusinessMemoryDeps,
  state = readOnlyWorkingMemorySource({ claimReceipts: [receipt] })
) {
  return observeShadowTurn(
    {
      rawText,
      state,
      tenantId: "default",
      operatorUserId: "adam-admin",
      surface: "voice",
      conversationKey: "claire-call:real-path",
      live,
    },
    {
      env: ON,
      memory: createInMemoryShadowMemoryStore(),
      sink: () => undefined,
      liveDeps: { business },
    }
  );
}

describe("production-equivalent shadow retrieval context", () => {
  it("uses the authoritative receipt identity to perform a fresh tenant-scoped reread", async () => {
    const verifyClaim = vi.fn(async (held: FactualClaimReceipt, tenantId: string) => ({
      receipt: held,
      outcome: "verified",
      resolution: "fresh_query",
      evidenceChanged: false,
      freshnessAffected: false,
      timedOut: false,
      latencyMs: 1,
    }) as PriorClaimVerification);

    const result = await observe("Are you sure?", deps({ verifyClaim }));
    expect(result.observed).toBe(true);
    if (!result.observed) return;
    expect(verifyClaim).toHaveBeenCalledWith(receipt, "default");
    expect(result.comparison.retrievalKinds).toContain("businessMemory:prior_claim_recheck");
    expect(result.comparison.evidenceTypes).toContain("prior_claim_recheck");
    expect(result.comparison.control.epistemic.priorClaimRechecked).toBe(true);
  });

  it("passes the real Day Director identity, business date and zone to loadDayWork", async () => {
    const loadOperations = vi.fn(async () => ({
      businessDate: "2026-09-20",
      open: [
        {
          id: "day-director:1",
          title: "Review route",
          status: "open" as const,
          source: "day_line" as const,
          timing: null,
          completedAt: null,
        },
      ],
      completed: [],
      routeAvailable: true,
    }));

    const result = await observe(
      "What do I have today?",
      deps({ loadOperations }),
      readOnlyWorkingMemorySource({})
    );
    expect(result.observed).toBe(true);
    expect(loadOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "42",
        businessDate: "2026-09-20",
        timeZone: "America/Los_Angeles",
      })
    );
    if (result.observed) expect(result.comparison.evidenceTypes).toContain("operations");
  });

  it("does not run for an operator outside the initial validation scope", async () => {
    const result = await observeShadowTurn(
      {
        rawText: "What do I have today?",
        tenantId: "another-tenant",
        operatorUserId: "someone-else",
        surface: "voice",
        conversationKey: "outside-scope",
      },
      { env: ON }
    );
    expect(result).toEqual({ observed: false, reason: "operator_not_authorized" });
  });

  it("records the observation even if V2 working memory fails to persist", async () => {
    const memory = createInMemoryShadowMemoryStore();
    memory.save = async () => {
      throw new Error("shadow store down");
    };
    const result = await observeShadowTurn(
      {
        rawText: "What do I have today?",
        tenantId: "default",
        operatorUserId: "adam-admin",
        surface: "voice",
        conversationKey: "claire-call:persist-fail",
        live,
      },
      {
        env: ON,
        memory,
        sink: () => undefined,
        liveDeps: {
          business: deps({
            loadOperations: async () => ({
              businessDate: "2026-09-20",
              open: [],
              completed: [],
              routeAvailable: true,
            }),
          }),
        },
      }
    );
    expect(result.observed).toBe(true);
  });
});
