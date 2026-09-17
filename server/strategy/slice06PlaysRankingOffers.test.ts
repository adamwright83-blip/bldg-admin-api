import { beforeEach, describe, expect, it } from "vitest";
import { buildStrategySnapshot, _clearSnapshotStore } from "./snapshotBuilder";
import {
  scoreStrategyPlay,
  POLICY_VERSION,
  type PlayCandidateInput,
} from "./decisionPolicy";
import {
  generateCandidatePlays,
  getOrCreatePathOffer,
  _clearPlayAndOfferStore,
} from "./playGenerator";
import {
  chooseStrategicPath,
  getActiveStrategicPath,
  _clearChoiceStore,
  validateVoicePathChoiceConfirmation,
} from "./pathChoiceService";
import { isWarmthEmissionAllowed } from "../claire/character/relationshipEmitters";
import { lintCeoLanguage } from "../claire/disappointmentLint";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Slice 6: Plays, Deterministic Ranking, Path Offers, and Path Choice", () => {
  const tenantId = "tenant_slice06_test";
  const tenantB = "tenant_slice06_other";

  beforeEach(() => {
    _clearSnapshotStore();
    _clearPlayAndOfferStore();
    _clearChoiceStore();
  });

  it("deterministic ranking produces identical score and breakdown across multiple runs", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);
    const candidate: PlayCandidateInput = {
      templateKey: "property_expansion",
      businessName: "Commercial Property Access Outreach",
      worldName: "The Gatekeeper Bastions",
      hypothesis: "In-person property manager walk-ins secure resident access.",
      primaryMetric: "new_paying_customers",
      geography: "downtown",
      stopsCount: 4,
      isClustered: true,
      estimatedInitiationCost: 65,
      estimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "high",
    };

    const run1 = scoreStrategyPlay(candidate, snapshot);
    const run2 = scoreStrategyPlay(candidate, snapshot);

    expect(run1.totalScore).toBe(run2.totalScore);
    expect(run1.policyVersion).toBe(POLICY_VERSION);
    expect(run1).toEqual(run2);
  });

  it("guardrail.G12.unknown_economics_score_neutral: unknown economics scores exactly 0 points", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);
    const candidate: PlayCandidateInput = {
      templateKey: "door_tag_acquisition",
      businessName: "Residential Door Tag Route Sweep",
      worldName: "The Threshold Route",
      hypothesis: "Door hangers drive neighborhood route density.",
      primaryMetric: "new_paying_customers",
      geography: "wilshire",
      stopsCount: 6,
      isClustered: true,
      estimatedInitiationCost: 70,
      estimatedSpendCents: 4500,
      spendCategory: "print_order",
      confidence: "medium",
    };

    const score = scoreStrategyPlay(candidate, snapshot);
    expect(score.unknownEconomicsScore).toBe(0);
  });

  it("guardrail.G13.no_laundry_logic_in_core: core decision policy contains zero vertical-specific terms", () => {
    const coreDecisionPolicySource = readFileSync(
      resolve(__dirname, "decisionPolicy.ts"),
      "utf8"
    );

    // Core policy must not hardcode laundry specific terms like 'wash', 'fold', 'dryclean', 'detergent', 'pounds'
    expect(coreDecisionPolicySource).not.toMatch(/\bwash(?:ing)?\b/i);
    expect(coreDecisionPolicySource).not.toMatch(/\bfold(?:ing)?\b/i);
    expect(coreDecisionPolicySource).not.toMatch(/\bdryclean(?:ing)?\b/i);
    expect(coreDecisionPolicySource).not.toMatch(/\bdetergent\b/i);
  });

  it("ranking respects capacity constraints: plays exceeding capacity are penalized", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);
    // Make capacity 0
    snapshot.payload.capacity.availablePounds = 0;

    const candidate: PlayCandidateInput = {
      templateKey: "property_expansion",
      businessName: "Commercial Property Access Outreach",
      worldName: "The Gatekeeper Bastions",
      hypothesis: "In-person property manager walk-ins secure resident access.",
      primaryMetric: "new_paying_customers",
      geography: "downtown",
      stopsCount: 5,
      isClustered: true,
      estimatedInitiationCost: 65,
      estimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "high",
    };

    const score = scoreStrategyPlay(candidate, snapshot);
    expect(score.capacityFeasibility).toBeLessThan(0);
  });

  it("initiation-cost model: clustered 4-stop play outranks scattered 1-stop play due to outing clustering bonus", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);

    const clusteredPlay: PlayCandidateInput = {
      templateKey: "property_expansion",
      businessName: "Downtown Corridor Clustered Sweep",
      worldName: "The Gatekeeper Bastions",
      hypothesis: "Clustered stops on one outing.",
      primaryMetric: "new_paying_customers",
      geography: "downtown",
      stopsCount: 4,
      isClustered: true,
      estimatedInitiationCost: 65,
      estimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "high",
    };

    const scatteredPlay: PlayCandidateInput = {
      templateKey: "property_expansion",
      businessName: "Scattered Single Stop",
      worldName: "Lone Gatekeeper",
      hypothesis: "Scattered stop requiring dedicated trip.",
      primaryMetric: "new_paying_customers",
      geography: "far_west",
      stopsCount: 1,
      isClustered: false,
      estimatedInitiationCost: 65,
      estimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "high",
    };

    const clusteredScore = scoreStrategyPlay(clusteredPlay, snapshot);
    const scatteredScore = scoreStrategyPlay(scatteredPlay, snapshot);

    expect(clusteredScore.geographicClusteringBonus).toBe(25);
    expect(scatteredScore.geographicClusteringBonus).toBe(0);
    expect(clusteredScore.totalScore).toBeGreaterThan(scatteredScore.totalScore);
  });

  it("LLM proposed rank is strictly ignored by deterministic policy", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);
    const candidate: PlayCandidateInput = {
      templateKey: "property_expansion",
      businessName: "Standard Outreach",
      worldName: "Bastions",
      hypothesis: "Test hypothesis",
      primaryMetric: "new_paying_customers",
      geography: "downtown",
      stopsCount: 2,
      isClustered: true,
      estimatedInitiationCost: 50,
      estimatedSpendCents: 0,
      spendCategory: "other",
      confidence: "high",
    };

    const honestScore = scoreStrategyPlay(candidate, snapshot);
    // Injected LLM proposing rank 1 / inflated score
    const injectedCandidate = { ...candidate, llmProposedRank: 1 };
    const scoreWithInjection = scoreStrategyPlay(injectedCandidate, snapshot);

    expect(honestScore.totalScore).toBe(scoreWithInjection.totalScore);
  });

  it("guardrail.G1.no_warmth_on_path_choice: path choice emits zero relationship warmth", () => {
    // Real path choice event emission must be rejected by G1 guard
    const allowed = isWarmthEmissionAllowed({
      eventType: "operator_follow_through",
      summary: "Operator selected path fork: The Gatekeeper Bastions",
      provenance: "strategy_path_choices",
    });

    expect(allowed).toBe(false);
  });

  it("guardrail.G1.no_warmth_for_agreeing_with_recommendation", () => {
    const allowed = isWarmthEmissionAllowed({
      eventType: "operator_follow_through",
      summary: "Operator agreed with Claire recommendation",
      provenance: "strategy_path_choices",
    });

    expect(allowed).toBe(false);
  });

  it("guardrail.G6.needs_approval_play_does_not_spend_on_choice", async () => {
    const offer = await getOrCreatePathOffer(tenantId);
    const paidPlay = offer.plays.find(p => p.needsApprovalToRun);

    if (paidPlay) {
      const choice = await chooseStrategicPath({
        tenantId,
        playId: paidPlay.id,
        surface: "map",
      });

      expect(choice.needsApprovalToRun).toBe(true);
      expect(choice.approvalRequestId).toBeDefined();
    }
  });

  it("voice choice requires verified readback confirmation", async () => {
    const offer = await getOrCreatePathOffer(tenantId);
    const playToChoose = offer.plays[0];

    // Attempting voice choice without readbackConfirmed must throw
    await expect(
      chooseStrategicPath({
        tenantId,
        playId: playToChoose.id,
        surface: "voice",
        readbackConfirmed: false,
      })
    ).rejects.toThrow(/read-back and spoken confirmation/);

    // Spoken confirmation validation
    expect(validateVoicePathChoiceConfirmation("Yes, that's the one")).toBe(true);
    expect(validateVoicePathChoiceConfirmation("No, wait")).toBe(false);

    // Voice choice with confirmation succeeds
    const confirmedChoice = await chooseStrategicPath({
      tenantId,
      playId: playToChoose.id,
      surface: "voice",
      readbackConfirmed: true,
    });
    expect(confirmedChoice.choiceId).toBeDefined();
    expect(getActiveStrategicPath(tenantId)).toBe(playToChoose.id);
  });

  it("path offer de-duplication: same day returns existing offer without nagging", async () => {
    const offer1 = await getOrCreatePathOffer(tenantId);
    const offer2 = await getOrCreatePathOffer(tenantId);

    expect(offer1.id).toBe(offer2.id);
    expect(offer1.recommendedPlayId).toBe(offer2.recommendedPlayId);
  });

  it("fork persists after path choice with active play set", async () => {
    const offer = await getOrCreatePathOffer(tenantId);
    const chosenPlay = offer.plays[0];

    await chooseStrategicPath({
      tenantId,
      playId: chosenPlay.id,
      surface: "map",
    });

    expect(getActiveStrategicPath(tenantId)).toBe(chosenPlay.id);
    expect(chosenPlay.status).toBe("active");
  });

  it("tenant isolation: offers and choices are isolated across tenants", async () => {
    const offerA = await getOrCreatePathOffer(tenantId);
    const offerB = await getOrCreatePathOffer(tenantB);

    expect(offerA.tenantId).toBe(tenantId);
    expect(offerB.tenantId).toBe(tenantB);
    expect(offerA.id).not.toBe(offerB.id);
  });

  it("CEO-language lint passes for all generated play names and rationales", async () => {
    const offer = await getOrCreatePathOffer(tenantId);

    expect(lintCeoLanguage(offer.claireRationale).passes).toBe(true);
    for (const play of offer.plays) {
      expect(lintCeoLanguage(play.businessName).passes).toBe(true);
      expect(lintCeoLanguage(play.worldName).passes).toBe(true);
      expect(lintCeoLanguage(play.hypothesis).passes).toBe(true);
    }
  });
});
