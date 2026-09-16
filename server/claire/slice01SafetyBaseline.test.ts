import { describe, expect, it } from "vitest";
import {
  isWarmthEmissionAllowed,
  WARMTH_EMISSION_ALLOWLIST,
} from "./character/relationshipEmitters";
import { requiresPr148SpendClearance } from "./proactive/boardService";
import { requiresSpendClearance } from "../strategy/spendClearance";
import {
  AssertionGuard,
  VerifiedFactInventoryBuilder,
  lintPostGenerationStateVerbs,
} from "./assertionGuard";
import { assertClaireRuntimeRouting } from "./runtimeRepairCheck";
import { invokeLLM, invokeTextLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import {
  isStrategyFeatureEnabled,
  setStrategyFeatureFlag,
  STRATEGY_FLAGS,
} from "../../shared/strategyFeatureFlags";

describe("Slice 1: Safety Baseline", () => {
  describe("guardrail.G1.no_warmth_on_acceptance", () => {
    it("rejects warmth emission on mission or commitment acceptance", () => {
      expect(
        isWarmthEmissionAllowed({
          eventType: "mission_accepted",
          summary: "Operator accepted mission",
          provenance: "voice_commitment_loop",
        })
      ).toBe(false);

      expect(
        isWarmthEmissionAllowed({
          eventType: "commitment_accepted",
          summary: "Accepted proposed commitment",
        })
      ).toBe(false);

      expect(
        isWarmthEmissionAllowed({
          eventType: "operator_follow_through",
          summary: "Accepted mission proposal", // forbidden keyword
        })
      ).toBe(false);
    });

    it("allows warmth emission only for verified completion of work", () => {
      expect(
        isWarmthEmissionAllowed({
          eventType: "operator_follow_through",
          summary: "Confirmed a real visit outcome for mission 10",
          provenance: "debrief_confirm",
        })
      ).toBe(true);

      expect(
        isWarmthEmissionAllowed({
          eventType: "shared_hard_win",
          summary: "Won mission 10",
          provenance: "debrief_confirm",
        })
      ).toBe(true);

      expect(WARMTH_EMISSION_ALLOWLIST.has("operator_follow_through")).toBe(true);
      expect(WARMTH_EMISSION_ALLOWLIST.has("shared_hard_win")).toBe(true);
    });
  });

  describe("guardrail.G1.no_warmth_on_path_choice", () => {
    it("forward-declared: rejects warmth emission on path choice or agreeing with recommendation", () => {
      expect(
        isWarmthEmissionAllowed({
          eventType: "path_choice",
          summary: "Operator chose tower expansion path",
          provenance: "lantern_city_fork",
        })
      ).toBe(false);

      expect(
        isWarmthEmissionAllowed({
          eventType: "agreed_with_recommendation",
          summary: "Player picked Claire's recommended route",
          provenance: "voice_pre_drive",
        })
      ).toBe(false);
    });
  });

  describe("guardrail.G6.pr148_cannot_spend_without_clearance", () => {
    it("enforces $0 default ceiling and blocks any PR #148 spend without clearance", async () => {
      const clearance = await requiresPr148SpendClearance({
        tenantId: "test-tenant-1",
        amountCents: 5000,
        category: "paid_ads",
      });

      expect(clearance.allowed).toBe(false);
      expect(clearance.reason).toBe("spend_clearance_default_zero_ceiling");

      const direct = await requiresSpendClearance({
        tenantId: "test-tenant-1",
        category: "print_order",
        amountCents: 100,
      });
      expect(direct.cleared).toBe(false);
      expect(direct.status).toBe("needs_approval");
    });

    it("supports disabling PR #148 wholesale via claire.strategy.legacyAutonomy", () => {
      const tenant = "test-tenant-autonomy";
      expect(isStrategyFeatureEnabled(tenant, STRATEGY_FLAGS.LEGACY_AUTONOMY)).toBe(true);

      setStrategyFeatureFlag(tenant, STRATEGY_FLAGS.LEGACY_AUTONOMY, false);
      expect(isStrategyFeatureEnabled(tenant, STRATEGY_FLAGS.LEGACY_AUTONOMY)).toBe(false);
      setStrategyFeatureFlag(tenant, STRATEGY_FLAGS.LEGACY_AUTONOMY, true);
    });
  });

  describe("guardrail.G4.sent_bug_regression", () => {
    it("evaluates draft message as pending, preventing unverified 'sent' claims", () => {
      // Obligation in draft state (draft: { sent: false })
      const status = AssertionGuard.verifyClaim({
        claimedState: "sent",
        entityRef: "recovery:customer-123",
        writtenTruthStatus: "draft",
      });

      expect(status).toBe("pending");

      const builder = new VerifiedFactInventoryBuilder();
      builder.addClaim({
        claimId: "claim-1",
        statement: "Rook win-back draft prepared for Sophie",
        entityRef: "recovery:customer-123",
        claimedState: "sent",
        provenance: "claire_proactive_doctrine",
        writtenTruthStatus: "draft",
      });

      const inventory = builder.build();
      expect(inventory.hasVerifiedClaim("sent")).toBe(false);

      // Post-generation lint catches false "I have sent" claims
      const speech = "Good morning Adam. I sent the message to Sophie already.";
      const lintResult = lintPostGenerationStateVerbs(speech, inventory);
      expect(lintResult.pass).toBe(false);
      expect(lintResult.violations[0]).toContain("State verb 'sent' claimed without verified write receipt");

      // Non-committal speech passes
      const validSpeech = "Good morning Adam. I have a draft prepared for Sophie for your review.";
      const validLint = lintPostGenerationStateVerbs(validSpeech, inventory);
      expect(validLint.pass).toBe(true);
    });
  });

  describe("runtime repair routing check", () => {
    it("confirms invokeTextLLM exists and invokeLLM requires outputSchema", async () => {
      const prevKey = ENV.anthropicApiKey;
      ENV.anthropicApiKey = "test-key";
      try {
        const routing = assertClaireRuntimeRouting();
        expect(routing.ok).toBe(true);
        expect(routing.textLlmConfigured).toBe(true);
        expect(typeof invokeTextLLM).toBe("function");

        // invokeLLM without outputSchema throws an error
        await expect(
          invokeLLM({
            messages: [{ role: "user", content: "test" }],
            // @ts-expect-error test invalid invocation without schema
            outputSchema: undefined,
          })
        ).rejects.toThrow(/requires outputSchema/);
      } finally {
        ENV.anthropicApiKey = prevKey;
      }
    });
  });
});
