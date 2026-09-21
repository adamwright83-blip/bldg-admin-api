/**
 * Real-pipeline adversarial cases for Brain V2 shadow.
 *
 * Readers are injected at the adapter boundary. These tests drive Perception →
 * Working Memory Gate → Attention → Pass A → adapter → scope → Pass B →
 * Integration → ExecutiveDecision. They do not hand-build finished EvidenceItems
 * into integration.
 */

import { describe, expect, it, vi } from "vitest";
import type { AccountHistory, AccountRef } from "../../knowledge/accountKnowledge";
import type { BusinessMemoryDeps } from "../businessMemory/adapter";
import { planRetrievalPassB } from "../executive/retrievalPlan";
import { liveExecutiveDeps, observeShadowTurn, type ShadowRetrievalContext } from "../shadow/observeShadowTurn";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";
import { createInMemoryShadowMemoryStore } from "../shadow/shadowMemory";
import type { AttentionPlan } from "../contracts/attention";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";

const ON = { CLAIRE_BRAIN_V2_SHADOW: "1" } as unknown as NodeJS.ProcessEnv;

const louise: AccountRef = { id: 77, name: "The Louise", accountType: "property" };

const live: ShadowRetrievalContext = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  conversationId: "pipeline",
  dayDirectorActorId: "42",
  businessDate: "2026-09-20",
  timeZone: "America/Los_Angeles",
  surface: "voice",
  priorClaimReceipts: [],
};

function history(account: AccountRef): AccountHistory {
  return {
    account,
    missions: [],
    events: [],
    fieldVisits: [],
    outcomes: [],
    followUps: [],
    pipelineStage: null,
    pipelineId: null,
    contacts: [{ name: "Dana", title: null, relationshipType: "primary" }],
    dayLineMentions: [],
    conversationMentions: [],
  };
}

function deps(overrides: Partial<BusinessMemoryDeps> = {}): BusinessMemoryDeps {
  const unexpected = async () => {
    throw new Error("unexpected reader");
  };
  return {
    runQuery: unexpected,
    listAccounts: async () => [louise],
    listContacts: async () => [
      {
        accountId: 77,
        accountName: "The Louise",
        accountType: "property",
        contactName: "Dana",
        title: null,
        relationshipType: "primary",
      },
    ],
    loadHistory: async ({ account }) => history(account),
    loadOpenOrders: unexpected,
    loadOperations: unexpected,
    verifyClaim: unexpected,
    ...overrides,
  } as BusinessMemoryDeps;
}

function observe(rawText: string, business: BusinessMemoryDeps) {
  return observeShadowTurn(
    {
      rawText,
      tenantId: "default",
      operatorUserId: "adam-admin",
      surface: "voice",
      conversationKey: "claire-call:pipeline",
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

describe("Pass B does not request tenant-wide unpaid orders for an account judgment", () => {
  it("omits open_orders once Dana resolves to The Louise", () => {
    const perceived = { assembledText: "What should I do about Dana?", businessIntent: "judgment_question" } as PerceivedTurn;
    const attention = {
      retrieve: ["businessMemory", "episodicMemory"],
      doNotRetrieve: [],
      boardEligible: false,
      continueOrderedQuery: false,
      activeTaskSets: [{ kind: "account_judgment", subject: "Dana", openedAtMs: 1 }],
    } as unknown as AttentionPlan;
    const requests = planRetrievalPassB({
      perceived,
      memory: { priorClaims: [] } as unknown as WorkingMemorySnapshot,
      attention,
      scope: { accountIds: [77], terms: ["Dana", "The Louise"], ambiguous: false },
    });
    expect(requests.some(request => request.kind === "open_orders")).toBe(false);
    expect(requests.some(request => request.kind === "account_state")).toBe(true);
  });
});

describe("unrelated tenant unpaid orders cannot influence a Dana judgment", () => {
  it("never loads the tenant-wide unpaid reader for What should I do about Dana?", async () => {
    const loadOpenOrders = vi.fn(async () => [
      { id: 99, customerName: "Unrelated", status: "processing", totalCents: 8800, pickupDate: "2026-09-20", deliveryDate: null, building: null },
    ]);
    const result = await observe("What should I do about Dana?", deps({ loadOpenOrders }));
    expect(result.observed).toBe(true);
    expect(loadOpenOrders).not.toHaveBeenCalled();
    if (!result.observed) return;
    expect(result.comparison.evidenceTypes).not.toContain("open_orders");
    const spoken = JSON.stringify(result.comparison);
    expect(spoken).not.toContain("99");
    expect(result.comparison.conclusions).toContain("business_judgment");
  });
});

describe("partial coverage does not become evidence of absence", () => {
  it("does not speak a Nobody absence claim when coverage is incomplete", async () => {
    const result = await runClaireBrainTurn({
      rawText: "Who are the dormant customers?",
      tenantId: "default",
      operatorUserId: "adam-admin",
      surface: "voice",
      conversationKey: "claire-call:pipeline",
      executive: liveExecutiveDeps(live, {
        business: deps({
          runQuery: async () =>
            ({
              status: "ok",
              query: {
                metric: "dormant_customers",
                limit: 20,
                customerName: null,
                rank: null,
                filters: null,
                serviceType: null,
                listMembers: true,
              },
              period: {
                spec: { kind: "all_time" },
                start: "2026-01-01",
                end: "2026-09-20",
                startUtc: new Date(0),
                endExclusiveUtc: new Date(0),
                days: 263,
                timeZone: "America/Los_Angeles",
                label: "all time",
              },
              comparisonPeriod: null,
              coverage: {
                completeness: "partial",
                loadedSources: ["laundry_butler"],
                failedSources: ["cleancloud"],
                unverifiedNativeCount: 0,
                unverifiedNativeCents: 0,
                overlap: {},
                serviceFilterUnclassified: null,
                lineage: null,
                union: null,
              },
              data: { kind: "customers", population: { count: 0, members: [] } },
            }) as never,
        }),
      }),
    });
    expect(result.decision.control.epistemic.negativeClaimLicensed).toBe(false);
    expect(result.candidateSpeak).toMatch(/verified later record/i);
    expect(result.candidateSpeak).not.toMatch(/Nobody/i);
    expect(result.decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(true);
  });
});

describe("reader unavailable is not a zero", () => {
  it("operations without Day Director context is unsupported, not an empty day", async () => {
    const result = await observeShadowTurn(
      {
        rawText: "What do I have today?",
        tenantId: "default",
        operatorUserId: "adam-admin",
        surface: "voice",
        conversationKey: "claire-call:no-ops",
        live: { ...live, dayDirectorActorId: "" },
      },
      {
        env: ON,
        memory: createInMemoryShadowMemoryStore(),
        sink: () => undefined,
        liveDeps: { business: deps() },
      }
    );
    expect(result.observed).toBe(true);
    if (!result.observed) return;
    expect(result.comparison.evidenceReaders).toContain("unsupported_request");
    expect(result.comparison.conclusions).not.toContain("business_fact");
  });
});
