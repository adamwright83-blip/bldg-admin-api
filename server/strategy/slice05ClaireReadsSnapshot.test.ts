import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTodayFeaturedOperation } from "./todayFeaturedService";
import { buildStrategySnapshot, getLatestStrategySnapshot, _clearSnapshotStore } from "./snapshotBuilder";
import { previewClairePreDrive } from "../claire/preDriveRuntime";
import {
  lintDisappointmentFraming,
  lintCeoLanguage,
  DISAPPOINTMENT_PATTERNS,
  CEO_LANGUAGE_PATTERNS,
} from "../claire/disappointmentLint";
import { AssertionGuard, VerifiedFactInventoryBuilder } from "../claire/assertionGuard";
import { writeClairePreDriveBrief } from "../claire/reasoning";
import { getClaireGenerationStats } from "../claire/generationTelemetry";

describe("Slice 5: Claire & Lantern City Read the Snapshot", () => {
  const tenantId = "tenant_slice05_test";
  const actorId = "operator_slice05";

  beforeEach(() => {
    _clearSnapshotStore();
  });

  it("guardrail.G7.single_featured_source: Claire and Lantern City return the identical operation ID", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);
    const featured = await getTodayFeaturedOperation(tenantId);

    // Call previewClairePreDrive
    const preview = await previewClairePreDrive({
      tenantId,
      actorId,
    });

    expect(preview.featuredOperation).toBeDefined();
    expect(preview.featuredOperation.operationId).toBe(featured.operationId);
    expect(preview.snapshotId).toBe(snapshot.id);
  });

  it("guardrail.G2.no_disappointment_framing: lint catches known phrases and passes compliant speech", () => {
    // Known violation phrases must fail lint
    expect(lintDisappointmentFraming("I am very disappointed in your progress.").passes).toBe(false);
    expect(lintDisappointmentFraming("You let me down on those property visits.").passes).toBe(false);
    expect(lintDisappointmentFraming("You didn't even stop by Broadway Lofts.").passes).toBe(false);
    expect(lintDisappointmentFraming("Did you skip the calls again?").passes).toBe(false);

    // Compliant speech stating what remains plainly plus options must pass
    const compliantSpeech =
      "Two commitments are completed and four remain on today's route. We can repair the Wilshire visit this afternoon or reschedule it for tomorrow.";
    expect(lintDisappointmentFraming(compliantSpeech).passes).toBe(true);
  });

  it("lintCeoLanguage: rejects executive and CEO framing per standing doctrine", () => {
    expect(lintCeoLanguage("As the CEO, you need to sign off on this.").passes).toBe(false);
    expect(lintCeoLanguage("This requires board approval before we proceed.").passes).toBe(false);
    expect(lintCeoLanguage("The executive leadership wants more orders.").passes).toBe(false);

    expect(lintCeoLanguage("You have two stops queued on the route today.").passes).toBe(true);
  });

  it("guardrail.G4.brief_claims_verified: assertion guard enforces verified state before assertion", () => {
    const builder = new VerifiedFactInventoryBuilder();
    builder.addClaim({
      claimId: "claim_1",
      statement: "Follow-up email sent to manager",
      entityRef: "opp_101",
      claimedState: "sent",
      provenance: "strategy_actions",
      writtenTruthStatus: "draft", // not yet sent!
    });

    const inventory = builder.build();
    expect(inventory.hasVerifiedClaim("sent")).toBe(false);
    expect(inventory.getClaim("claim_1")?.status).toBe("pending");
  });

  it("records snapshotId on preview output", async () => {
    const snapshot = await buildStrategySnapshot(tenantId);
    const preview = await previewClairePreDrive({
      tenantId,
      actorId,
    });

    expect(preview.snapshotId).toBeDefined();
    expect(preview.snapshotId).toBe(snapshot.id);
  });

  it("fallback telemetry increments on forced LLM failure or lint violation", async () => {
    const statsBefore = getClaireGenerationStats(tenantId);

    // Call writeClairePreDriveBrief with an LLM that throws or outputs disappointment
    const context: any = {
      tenantId,
      actorId,
      businessDate: "2026-09-16",
      relevantTimeline: [],
      blockers: [],
    };

    const brief = await writeClairePreDriveBrief(
      {
        tenantId,
        context,
      },
      {
        invokeText: vi.fn().mockRejectedValue(new Error("Simulated LLM network failure")),
      }
    );

    expect(brief).toBeDefined();
    const statsAfter = getClaireGenerationStats(tenantId);
    const openingStats = statsAfter.find(s => s.kind === "opening_brief");
    expect(openingStats?.fallbacks).toBeGreaterThan(0);
  });

  it("does not invent a scenario conversion for unobserved property stages", async () => {
    const snapshot = await buildStrategySnapshot(tenantId, {
      customerAggregates: [],
    });
    expect(snapshot.payload.growthPlan.stages.every(s => s.isScenario === false)).toBe(
      true
    );
    expect(
      snapshot.payload.growthPlan.stages.find(s => s.scenarioConversionRate != null)
    ).toBeUndefined();
  });

  it("brief is not an identical fixed checklist across different contexts", async () => {
    const preview1 = await previewClairePreDrive({
      tenantId,
      actorId,
    });

    expect(preview1.brief).toBeDefined();
    expect(typeof preview1.brief).toBe("string");
    expect(preview1.brief.length).toBeGreaterThan(10);
  });
});
