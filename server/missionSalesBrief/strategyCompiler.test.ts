import { describe, expect, it, vi } from "vitest";
import {
  compileMissionSalesStrategy,
  deterministicFallbackStrategy,
} from "./strategyCompiler";
import type { MissionSalesBriefEvidence } from "./evidenceAssembler";
import type { CommercialMission } from "../../shared/commercialMission";

function evidence(overrides: Partial<MissionSalesBriefEvidence> = {}): MissionSalesBriefEvidence {
  const mission = {
    id: 1,
    tenantId: "tenant-1",
    code: "MISSION 001",
    status: "arrived",
    version: 1,
    assignedTo: "operator-1",
    opsTaskId: null,
    account: {
      name: "Sunset Gardens",
      address: "123 Main St",
      accountType: "multifamily",
      decisionMaker: { name: "Dana", title: "Manager" },
    },
    opportunity: {
      estimateConfidence: "medium",
      score: 50,
      primarySignal: "Management previously showed interest.",
      reasons: [],
      risks: [],
    },
    brief: {
      laundryOpportunity: "shared laundry",
      salesAngle: "no-cost resident amenity",
      openingLine: "Hi Dana, following up on the resident laundry program.",
      discoveryQuestions: ["What stopped this from moving forward?"],
      objections: [],
    },
    steps: [],
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  } as unknown as CommercialMission;

  return {
    tenantId: "tenant-1",
    missionId: 1,
    accountId: 7,
    mission,
    currentVisitOutcome: null,
    priorOutcomes: [],
    knownFacts: [
      {
        text: "Management previously showed interest.",
        provenance: "authoritative_evidence",
        sourceReference: "commercial_missions:1:opportunity",
      },
    ],
    evidenceThrough: new Date().toISOString(),
    ...overrides,
  };
}

describe("F/P — strategy compiler: fact/recommendation separation and failure fallback", () => {
  it("E/G — no visit outcome yet -> fallback surfaces the unknown blocker instead of inventing one", () => {
    const result = deterministicFallbackStrategy(evidence());
    expect(result.unknowns).toHaveLength(1);
    expect(result.unknowns[0].question).toMatch(/blocking/i);
    expect(result.recommendedApproach.primaryObjective).toMatch(/learn what is actually blocking/i);
    expect(result.source).toBe("fallback");
  });

  it("prior account history -> fallback avoids repeating the full pitch", () => {
    const result = deterministicFallbackStrategy(
      evidence({
        priorOutcomes: [
          {
            text: "A prior visit (mission 2) recorded: a follow-up was requested.",
            provenance: "authoritative_evidence",
            sourceReference: "commercial_visit_outcomes:2",
          },
        ],
      })
    );
    expect(result.recommendedApproach.thingsToAvoid.join(" ")).toMatch(/repeating the full introductory pitch/i);
  });

  it("P — LLM failure falls back to the deterministic, grounded strategy rather than breaking the mission", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("provider down"));
    const result = await compileMissionSalesStrategy({
      tenantId: "tenant-1",
      evidence: evidence(),
      knownFacts: evidence().knownFacts,
      intel: null,
      invoke,
    });
    expect(result.source).toBe("fallback");
    expect(result.recommendedApproach.primaryObjective).toMatch(/learn what is actually blocking/i);
  });

  it("P — malformed model output falls back rather than trusting unvalidated JSON", async () => {
    const invoke = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ garbage: true }) } }],
    });
    const result = await compileMissionSalesStrategy({
      tenantId: "tenant-1",
      evidence: evidence(),
      knownFacts: evidence().knownFacts,
      intel: null,
      invoke,
    });
    expect(result.source).toBe("fallback");
  });

  it("valid model output is used and grounded to the supplied evidence in the prompt", async () => {
    const invoke = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              primaryObjective: "Find out why the deal stalled.",
              recommendedOpening: null,
              questionsToAsk: ["What stopped this from moving forward?"],
              actionsToTake: [],
              thingsToAvoid: ["Repeating the introductory pitch."],
              successDefinition: "The blocker is identified.",
              unknowns: [{ question: "Why did it stall?", reason: "No objection is recorded." }],
            }),
          },
        },
      ],
    });
    const result = await compileMissionSalesStrategy({
      tenantId: "tenant-1",
      evidence: evidence(),
      knownFacts: evidence().knownFacts,
      intel: null,
      invoke,
    });
    expect(result.source).toBe("model");
    expect(result.recommendedApproach.primaryObjective).toBe("Find out why the deal stalled.");
    const promptPayload = JSON.parse(invoke.mock.calls[0][0].messages[1].content);
    expect(promptPayload.accountName).toBe("Sunset Gardens");
    expect(promptPayload.knownFacts).toContain("Management previously showed interest.");
  });

  it("passes reviewed sales teaching content into the mission-specific compiler", async () => {
    const invoke = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              primaryObjective: "Learn the blocker.",
              recommendedOpening: "Great — most properties we work with already have something in place. Let me show you where we fit alongside it.",
              questionsToAsk: ["What do residents still ask staff for help with?"],
              actionsToTake: [],
              thingsToAvoid: [],
              successDefinition: "A concrete next step is agreed.",
              unknowns: [],
            }),
          },
        },
      ],
    });

    await compileMissionSalesStrategy({
      tenantId: "tenant-1",
      evidence: evidence(),
      knownFacts: evidence().knownFacts,
      intel: {
        teachingId: "shelby-1",
        category: "objection_handling",
        title: "Do not fight the incumbent",
        rationale: "Matched the mission situation.",
        principle: "Validate the existing solution before positioning alongside it.",
        whenToUse: ["When a prospect says they already use someone."],
        whenNotToUse: [],
        exampleLanguage: ["Great — most of our customers already had something in place."],
      },
      invoke,
    });

    const promptPayload = JSON.parse(invoke.mock.calls[0][0].messages[1].content);
    expect(promptPayload.selectedSalesIntel.principle).toMatch(/existing solution/i);
    expect(promptPayload.selectedSalesIntel.exampleLanguage).toHaveLength(1);
  });
});
