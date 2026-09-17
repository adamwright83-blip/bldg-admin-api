import { describe, expect, it, beforeEach } from "vitest";
import {
  computePlayEvidence,
  attributeCustomer,
  recordOpportunityStallReason,
  proposeBoundedExperiment,
  getPlayEvidence,
  getStallReasons,
  _clearEvidenceStores,
} from "./evidenceEngine";
import { lintVerdictLanguage, lintCausalLanguage } from "./verdictLint";
import { registerStrategyPlay } from "./playGenerator";
import type { StrategyPlay } from "./decisionPolicy";

describe("Slice 8: Outcome Attribution as Evidence", () => {
  const tenantId = "tenant_slice08_test";
  const playId = "play_prop_slice08";

  beforeEach(() => {
    _clearEvidenceStores();

    // Register a test play with minimum evidence threshold: 14 days, 6 exposure units
    const testPlay: StrategyPlay = {
      id: playId,
      tenantId,
      businessName: "Luxury Property Expansion",
      worldName: "The High Gates",
      hypothesis: "Acquire luxury building amenity approvals",
      primaryMetric: "new_paying_customers",
      estimatedInitiationCost: 66,
      estimatedSpendCents: 0,
      confidence: "medium",
      evidenceReferences: [],
      scoreBreakdown: {
        verifiedOpportunityAdvance: 20,
        expectedTimeToFirstSale: 15,
        repeatPotential: 20,
        capacityAlignment: 15,
        travelEffort: -10,
        contributionMargin: 0,
        initiationCostPenalty: -20,
        clusteringBonus: 25,
        urgencyPace: 10,
        priorEvidence: 0,
        totalScore: 75,
      },
      status: "active",
      minimumEvidenceThreshold: {
        days: 14,
        minimumExposureUnits: 6,
      },
      createdBy: "engine",
      provenance: "test:slice08",
    };
    registerStrategyPlay(testPlay);
  });

  it("guardrail.G5.no_signal_below_threshold: evidence accumulates but no world signal fires below threshold", async () => {
    // 7 days and only 3 visits: below 14-day and 6-visit threshold
    const evidence = await computePlayEvidence({
      tenantId,
      playId,
      windowDays: 7,
      windowStart: "2026-09-01",
      windowEnd: "2026-09-08",
      funnelCounts: { visits: 3, conversations: 2, approvals: 0, newCustomers: 0 },
      exposureUnits: 3,
      linkedCustomers: 0,
    });

    expect(evidence.thresholdMet).toBe(false);
    expect(evidence.worldSignal).toBe("none"); // G5: Must be 'none' below threshold!
    expect(evidence.statement).toContain("7 days");
    expect(evidence.statement).toContain("3 actions deployed");
    expect(evidence.statement).toContain("0 linked paying customers");
  });

  it("signal reversibility: above threshold with zero customers dims; with customers brightens", async () => {
    // 14 days and 8 visits with 0 customers -> DIM
    const dimEvidence = await computePlayEvidence({
      tenantId,
      playId,
      windowDays: 14,
      windowStart: "2026-09-01",
      windowEnd: "2026-09-15",
      funnelCounts: { visits: 8, conversations: 5, approvals: 1, newCustomers: 0 },
      exposureUnits: 8,
      linkedCustomers: 0,
    });

    expect(dimEvidence.thresholdMet).toBe(true);
    expect(dimEvidence.worldSignal).toBe("dim");

    // Later: 2 customers link -> brightens
    const brightenEvidence = await computePlayEvidence({
      tenantId,
      playId,
      windowDays: 14,
      windowStart: "2026-09-01",
      windowEnd: "2026-09-15",
      funnelCounts: { visits: 8, conversations: 5, approvals: 1, newCustomers: 2 },
      exposureUnits: 8,
      linkedCustomers: 2,
    });

    expect(brightenEvidence.thresholdMet).toBe(true);
    expect(brightenEvidence.worldSignal).toBe("brighten");
  });

  it("guardrail.G5.no_verdict_language: lint rejects verdict words about plays", () => {
    const badTexts = [
      "This play is not working at all.",
      "The door tag route is failing.",
      "Visiting properties was a total waste of money.",
      "We are crushing it on the new route!",
      "A terrible play that was a massive flop.",
    ];

    for (const text of badTexts) {
      const lint = lintVerdictLanguage(text);
      expect(lint.valid).toBe(false);
      expect(lint.violations.length).toBeGreaterThan(0);
    }

    const goodText = "Two weeks, 80 door tags deployed, 3 QR visits, 0 orders.";
    const goodLint = lintVerdictLanguage(goodText);
    expect(goodLint.valid).toBe(true);
    expect(goodLint.violations.length).toBe(0);
  });

  it("guardrail.G12.no_causal_claims: lint rejects causal claims; requires linked phrasing", () => {
    const causalTexts = [
      "This play created 5 new customers.",
      "5 new customers were caused by this play.",
      "The route produced 10 customers this month.",
    ];

    for (const text of causalTexts) {
      const lint = lintCausalLanguage(text);
      expect(lint.valid).toBe(false);
      expect(lint.violations.length).toBeGreaterThan(0);
    }

    const linkedText = "14 days, 6 visits, 2 linked paying customers.";
    const linkedLint = lintCausalLanguage(linkedText);
    expect(linkedLint.valid).toBe(true);
  });

  it("attribution requires an explicit link; unlinked customers are marked unattributed", async () => {
    // Customer with explicit QR code link
    const linked = await attributeCustomer({
      tenantId,
      customerId: "cust_qr_01",
      linkType: "qr_code",
      linkRef: "qr_greystar_flyer_412",
      attributedPlayId: playId,
    });
    expect(linked.attributed).toBe(true);
    expect(linked.status).toBe("linked");
    expect(linked.playId).toBe(playId);
    expect(linked.linkType).toBe("qr_code");

    // Customer with no link
    const unlinked = await attributeCustomer({
      tenantId,
      customerId: "cust_unknown_walkin",
    });
    expect(unlinked.attributed).toBe(false);
    expect(unlinked.status).toBe("unattributed");
    expect(unlinked.playId).toBeNull();
  });

  it("untracked funnel steps are explicitly preserved as untracked", async () => {
    const evidence = await computePlayEvidence({
      tenantId,
      playId,
      windowDays: 14,
      windowStart: "2026-09-01",
      windowEnd: "2026-09-15",
      funnelCounts: { visits: 8, conversations: 6, newCustomers: 1 },
      untrackedFunnelSteps: ["qr_code_scans", "digital_impressions"],
      exposureUnits: 8,
      linkedCustomers: 1,
    });

    expect(evidence.untrackedFunnelSteps).toContain("qr_code_scans");
    expect(evidence.untrackedFunnelSteps).toContain("digital_impressions");
  });

  it("stall reasons are captured and linked to opportunities", async () => {
    const stall = await recordOpportunityStallReason({
      tenantId,
      opportunityId: "opp_grandview",
      source: "debrief",
      reason: "existing_provider",
      detail: "Property manager has an existing dry cleaning pickup contract ending in December.",
    });

    expect(stall.id).toBeDefined();
    expect(stall.reason).toBe("existing_provider");
    expect(stall.opportunityId).toBe("opp_grandview");

    const retrieved = getStallReasons(tenantId, "opp_grandview");
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].reason).toBe("existing_provider");
  });

  it("bounded experiments require all fields and never auto-run", async () => {
    const exp = await proposeBoundedExperiment({
      tenantId,
      hypothesis: "Test Saturday morning lobby coffee table setup",
      targetAudience: "Luxury condo residents",
      costLimitCents: 5000,
      observationWindowDays: 14,
      successMeasure: "At least 3 QR scan bookings",
    });

    expect(exp.id).toBeDefined();
    expect(exp.status).toBe("candidate"); // NEVER auto-runs!
    expect(exp.estimatedSpendCents).toBe(5000);
    expect(exp.minimumEvidenceThreshold.days).toBe(14);
    expect(exp.provenance).toContain("experiment:audience=");

    // Incomplete experiment input must throw
    await expect(
      proposeBoundedExperiment({
        tenantId,
        hypothesis: "",
        targetAudience: "Residents",
        costLimitCents: 1000,
        observationWindowDays: 7,
        successMeasure: "Signups",
      })
    ).rejects.toThrow("hypothesis");
  });

  it("provenance is attached to every evidence statement", async () => {
    const evidence = await computePlayEvidence({
      tenantId,
      playId,
      windowDays: 14,
      windowStart: "2026-09-01",
      windowEnd: "2026-09-15",
      funnelCounts: { visits: 10, newCustomers: 1 },
      exposureUnits: 10,
      linkedCustomers: 1,
    });

    expect(evidence.provenance).toBeDefined();
    expect(evidence.provenance.source).toBe("evidenceEngine:computePlayEvidence");
    expect(evidence.provenance.computedAt).toBeDefined();
    expect(evidence.provenance.thresholdRule).toContain("minDays: 14");
  });

  it("tenant isolation: evidence and stall reasons are strictly tenant-isolated", async () => {
    await recordOpportunityStallReason({
      tenantId: "tenant_isolated_A",
      opportunityId: "opp_A",
      source: "debrief",
      reason: "price",
    });

    const stallsB = getStallReasons("tenant_isolated_B");
    expect(stallsB.length).toBe(0);

    const stallsA = getStallReasons("tenant_isolated_A");
    expect(stallsA.length).toBe(1);
    expect(stallsA[0].tenantId).toBe("tenant_isolated_A");
  });
});
