/**
 * Business Memory boundary: what may cross into Executive Function, and what may not.
 *
 * Readers are injected, so these run without a database. That is deliberate — the
 * rules being tested are boundary rules, not query logic, and query logic is not
 * reimplemented here.
 */

import { describe, expect, it, vi } from "vitest";
import {
  admitBusinessEvidence,
  lookupPriorClaimReceipt,
  recheckPriorClaim,
  retrieveBusinessEvidence,
  UNSUPPORTED_REQUEST,
  type BusinessMemoryDeps,
} from "../businessMemory/adapter";
import { evidenceFromBusinessResult, resolvedMembers } from "../businessMemory/evidence";
import type { BusinessQueryResult } from "../../../analytics/businessQuery";
import type { FactualClaimReceipt, PriorClaimVerification } from "../../provenance/claimReceipts";
import type { EvidenceItem } from "../contracts/evidence";

const NOW = "2026-09-20T12:00:00.000Z";

const period = { spec: { kind: "all_time" }, start: "2026-01-01", end: "2026-09-20", startUtc: new Date(0), endExclusiveUtc: new Date(0), days: 263 } as never;

function okResult(overrides: Partial<Record<string, unknown>> = {}): BusinessQueryResult {
  return {
    status: "ok",
    query: { metric: "latest_sales", limit: 5, customerName: null, rank: null, filters: null, serviceType: null } as never,
    period,
    comparisonPeriod: null,
    coverage: {
      completeness: "complete",
      loadedSources: ["laundry_butler"],
      failedSources: [],
      unverifiedNativeCount: 0,
      unverifiedNativeCents: 0,
      overlap: {} as never,
      serviceFilterUnclassified: null,
      lineage: null,
      union: null,
    },
    data: {
      kind: "orders",
      ordering: "latest",
      orders: [
        { eventKey: "evt-1", customerName: "Thomas", orderNumber: "A1" },
        { eventKey: "evt-2", customerName: "Dana", orderNumber: "A2" },
      ],
    },
    ...overrides,
  } as unknown as BusinessQueryResult;
}

function deps(over: Partial<BusinessMemoryDeps> = {}): BusinessMemoryDeps {
  return {
    runQuery: async () => okResult(),
    listAccounts: async () => [],
    listContacts: async () => [],
    loadHistory: async ({ account }) =>
      ({
        account,
        missions: [],
        events: [],
        fieldVisits: [],
        outcomes: [],
        followUps: [],
        pipelineStage: null,
        pipelineId: null,
        contacts: [],
        dayLineMentions: [],
        conversationMentions: [],
      }) as never,
    loadOpenOrders: async () => [],
    loadOperations: async () => ({ businessDate: "2026-09-20", open: [], completed: [], routeAvailable: true }),
    verifyClaim: async () => ({}) as PriorClaimVerification,
    ...over,
  };
}

const ctx = { tenantId: "default", operatorUserId: "adam-admin", nowIso: NOW };

describe("business evidence preserves what Executive Function needs to judge it", () => {
  it("carries provenance, freshness, coverage, as-of and observed times", async () => {
    const [item] = await retrieveBusinessEvidence(
      { compartment: "businessMemory", kind: "business_query", query: { metric: "latest_sales" } as never },
      ctx,
      deps()
    );
    expect(item.provenance.reader).toBe("runBusinessQuery");
    expect(item.freshness).toEqual({ completeness: "complete", loadedSources: ["laundry_butler"], failedSources: [] });
    expect(item.coverage).toEqual({ complete: true, gaps: [] });
    expect(item.observedAt).toBe(NOW);
    // As-of is the period the numbers describe, not the clock time we asked.
    expect(item.asOf).toBe("2026-09-20");
    expect(item.authoritativeFor).toContain("current_business_truth");
  });

  it("records coverage gaps instead of presenting a partial read as exhaustive", async () => {
    const partial = okResult({
      coverage: {
        completeness: "partial",
        loadedSources: ["laundry_butler"],
        failedSources: ["cleancloud"],
        unverifiedNativeCount: 3,
        unverifiedNativeCents: 900,
        overlap: {} as never,
        serviceFilterUnclassified: null,
        lineage: null,
        union: null,
      },
    });
    const [item] = await retrieveBusinessEvidence(
      { compartment: "businessMemory", kind: "business_query", query: {} as never },
      ctx,
      deps({ runQuery: async () => partial })
    );
    expect(item.coverage?.complete).toBe(false);
    expect(item.coverage?.gaps).toContain("ledger_completeness:partial");
    expect(item.coverage?.gaps).toContain("failed_source:cleancloud");
    expect(item.coverage?.gaps).toContain("unverified_native_orders:3");
  });

  it("an unavailable read never claims current business truth", () => {
    const unavailable = { status: "unavailable", query: { metric: "revenue" }, period, comparisonPeriod: null, reason: "sources unbound" } as unknown as BusinessQueryResult;
    const item = evidenceFromBusinessResult({ result: unavailable, reader: "runBusinessQuery", observedAtIso: NOW });
    // Fail closed: this may inform, but it may not back a BusinessFactSegment.
    expect(item.authoritativeFor).toEqual([]);
  });

  it("exposes stable member identities for ordered-query continuation", () => {
    expect(resolvedMembers(okResult())).toEqual([
      { id: "evt-1", label: "Thomas" },
      { id: "evt-2", label: "Dana" },
    ]);
  });

  it("does not invent an answer when nothing was retrieved", async () => {
    const items = await retrieveBusinessEvidence(
      { compartment: "businessMemory", kind: "business_query" },
      ctx,
      deps()
    );
    expect(items).toEqual([]);
  });
});

describe("synthetic evidence is rejected at the boundary", () => {
  function evidence(payload: Record<string, unknown>, provenance: Record<string, unknown> = {}): EvidenceItem {
    return {
      id: "e1",
      type: "account_state",
      source: "reader",
      provenance: { reader: "reader", ...provenance },
      observedAt: NOW,
      asOf: NOW,
      freshness: null,
      coverage: null,
      authoritativeFor: ["current_business_truth"],
      payload,
      operatorVisible: true,
    };
  }

  it("rejects fixture and synthetic payloads", () => {
    expect(admitBusinessEvidence([evidence({ fixture: true })])).toEqual([]);
    expect(admitBusinessEvidence([evidence({ synthetic: true })])).toEqual([]);
  });

  it("rejects test account types and sandboxed identity keys", () => {
    expect(admitBusinessEvidence([evidence({ accountType: "laundry_test" })])).toEqual([]);
    expect(admitBusinessEvidence([evidence({ identityKey: "sandbox:abc" })])).toEqual([]);
    expect(admitBusinessEvidence([evidence({ providerName: "production-verifier" })])).toEqual([]);
  });

  it("filters synthetic accounts out of contact/account resolution", async () => {
    const items = await retrieveBusinessEvidence(
      { compartment: "businessMemory", kind: "contact_account_resolution" },
      ctx,
      deps({
        listAccounts: async () => [
          { id: 1, name: "The Louise", accountType: "property" },
          { id: 2, name: "CODEX E2E SAFE TO ARCHIVE", accountType: "qa_fixture" },
        ],
      })
    );
    expect(items.map(item => (item.payload as { name: string }).name)).toEqual(["The Louise"]);
  });

  it("a contact at a synthetic account does not resolve", async () => {
    const items = await retrieveBusinessEvidence(
      { compartment: "businessMemory", kind: "contact_account_resolution", mentions: ["Dana"] },
      ctx,
      deps({
        listAccounts: async () => [{ id: 2, name: "Fixture Co", accountType: "qa_fixture" }],
        listContacts: async () => [
          { accountId: 2, accountName: "Fixture Co", accountType: "qa_fixture", contactName: "Dana", title: null, relationshipType: "primary" },
        ],
      })
    );
    expect(items).toEqual([]);
  });

  it("does NOT use a display name as provenance", async () => {
    // "CODEX" in a name is not a write-path stamp. A real account type keeps it visible.
    const items = await retrieveBusinessEvidence(
      { compartment: "businessMemory", kind: "contact_account_resolution" },
      ctx,
      deps({ listAccounts: async () => [{ id: 3, name: "CODEX Holdings", accountType: "property" }] })
    );
    expect(items).toHaveLength(1);
  });

  it("admits a genuine operator row", () => {
    expect(admitBusinessEvidence([evidence({ accountType: "property" })])).toHaveLength(1);
  });
});

describe("prior claims", () => {
  const receipt: FactualClaimReceipt = {
    id: "r1",
    conversationKey: "k",
    claireTurnOrdinal: 3,
    claimedAtMs: 1,
    claimType: "revenue",
    answerText: "Revenue was $4,200.",
    grounding: "deterministic",
    answerPath: "business",
    reader: "runBusinessQuery",
    metric: "revenue",
    periodLabel: "last 30 days",
    evidence: [{ source: "ledger", ref: "evt-1" }],
    fingerprint: "abc",
    newestRecordAt: null,
    asOf: "2026-09-19",
    freshness: null,
    recheck: { kind: "business_query", query: {} as never },
  };

  it("'where did that come from?' may answer from the receipt alone", async () => {
    const outcome = await recheckPriorClaim(
      { compartment: "businessMemory", kind: "prior_claim_recheck", receiptId: "r1", mode: "provenance" },
      { ...ctx, priorClaimReceipts: [receipt] },
      deps()
    );
    expect(outcome?.recheck.resolution).toBe("receipt_only");
    // A provenance receipt is NOT a claim that the number is still true now.
    expect(outcome?.evidence[0].authoritativeFor).toEqual(["provenance_receipt"]);
  });

  it("'are you sure?' performs a fresh reread and that reread speaks for current truth", async () => {
    const outcome = await recheckPriorClaim(
      { compartment: "businessMemory", kind: "prior_claim_recheck", receiptId: "r1", mode: "correctness" },
      { ...ctx, priorClaimReceipts: [receipt] },
      deps({
        verifyClaim: async () =>
          ({ receipt, outcome: "verified", resolution: "fresh_query", evidenceChanged: false, freshnessAffected: false, timedOut: false, latencyMs: 4 }) as PriorClaimVerification,
      })
    );
    expect(outcome?.recheck.resolution).toBe("fresh_query");
    expect(outcome?.evidence[0].authoritativeFor).toContain("current_business_truth");
  });

  it("a stale receipt-only recheck may not speak for current truth", async () => {
    const outcome = await recheckPriorClaim(
      { compartment: "businessMemory", kind: "prior_claim_recheck", receiptId: "r1", mode: "correctness" },
      { ...ctx, priorClaimReceipts: [receipt] },
      deps({
        verifyClaim: async () =>
          ({ receipt, outcome: "unverifiable", resolution: "receipt_only", evidenceChanged: null, freshnessAffected: false, timedOut: true, latencyMs: 9 }) as PriorClaimVerification,
      })
    );
    expect(outcome?.evidence[0].authoritativeFor).not.toContain("current_business_truth");
  });

  it("an unknown receipt id resolves to nothing rather than a guess", async () => {
    const outcome = await recheckPriorClaim(
      { compartment: "businessMemory", kind: "prior_claim_recheck", receiptId: "missing", mode: "correctness" },
      { ...ctx, priorClaimReceipts: [receipt] },
      deps()
    );
    expect(outcome).toBeNull();
  });

  it("looks up the authoritative receipt by id from the supplied conversation receipts", () => {
    expect(lookupPriorClaimReceipt([receipt], "r1")).toBe(receipt);
    expect(lookupPriorClaimReceipt([receipt], "missing")).toBeNull();
  });

  it("passes the context tenant into verify, never a hardcoded default", async () => {
    const verifyClaim = vi.fn(
      async () =>
        ({
          receipt,
          outcome: "verified",
          resolution: "fresh_query",
          evidenceChanged: false,
          freshnessAffected: false,
          timedOut: false,
          latencyMs: 1,
        }) as PriorClaimVerification
    );
    await recheckPriorClaim(
      { compartment: "businessMemory", kind: "prior_claim_recheck", receiptId: "r1", mode: "correctness" },
      { ...ctx, tenantId: "tenant-b", priorClaimReceipts: [receipt] },
      deps({ verifyClaim })
    );
    expect(verifyClaim).toHaveBeenCalledWith(receipt, "tenant-b");
  });
});

describe("open orders cannot contaminate an account judgment", () => {
  it("refuses an account-scoped unpaid read rather than returning the tenant total", async () => {
    let loaded = 0;
    const items = await retrieveBusinessEvidence(
      { compartment: "businessMemory", kind: "open_orders", accountId: 77 },
      ctx,
      deps({
        loadOpenOrders: async () => {
          loaded += 1;
          return [{ id: 1, customerName: "Unrelated", status: "processing", totalCents: 9000, pickupDate: "2026-09-20", deliveryDate: null, building: null }];
        },
      })
    );
    expect(loaded).toBe(0);
    expect(items[0]?.source).toBe(UNSUPPORTED_REQUEST);
    expect(items[0]?.authoritativeFor).toEqual([]);
    expect((items[0]?.payload as { unsupported?: boolean }).unsupported).toBe(true);
  });
});

describe("structural provenance columns reach the classifier", () => {
  it("excludes a fixture provider even when the display name looks real", async () => {
    const items = await retrieveBusinessEvidence(
      { compartment: "businessMemory", kind: "contact_account_resolution" },
      ctx,
      deps({
        listAccounts: async () => [
          { id: 9, name: "The Marlowe", accountType: "property", providerName: "fixture" },
        ],
      })
    );
    expect(items).toEqual([]);
  });
});
