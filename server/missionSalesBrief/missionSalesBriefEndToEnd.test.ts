import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionSalesBriefEvidence } from "./evidenceAssembler";
import type { CommercialMission } from "../../shared/commercialMission";

/**
 * The one true Pass 2 end-to-end proof: prior interest + unknown blocker ->
 * Brief v1 -> Claire and FIELD both read v1 -> a real, operator-attested
 * outcome persists new evidence -> requesting the current brief produces
 * an immutable v2 -> v1 is untouched -> v2's known facts/strategy reflect
 * exactly what was learned -> Claire's next guidance reflects v2.
 *
 * Uses the real production service/compiler code
 * (missionSalesBriefService, strategyCompiler, Claire's reasoning.ts).
 * Only the two things local infrastructure can't provide are faked: the
 * database (evidenceAssembler + sales-intel eligibility are mocked at
 * their DB boundary) and the live model (invokeLLM is mocked so the test
 * is deterministic, matching how the deterministic fallback would behave
 * if the model were briefly unavailable in production).
 */

const mocks = vi.hoisted(() => ({
  assembleMissionSalesBriefEvidence: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("./evidenceAssembler", () => ({
  assembleMissionSalesBriefEvidence: mocks.assembleMissionSalesBriefEvidence,
}));
vi.mock("../salesIntel/salesIntelTeachingStore", () => ({
  listAllAcceptedTeachings: vi.fn().mockResolvedValue([]),
}));
vi.mock("../_core/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/llm")>();
  return { ...actual, invokeLLM: mocks.invokeLLM };
});

import { ensureCurrentMissionSalesBrief } from "./missionSalesBriefService";
import { toCompactMissionSalesBriefForClaire, toFieldMissionSalesBrief } from "../../shared/missionSalesBrief";
import { setMissionSalesBriefStoreForTesting } from "./store";
import { createInMemoryMissionSalesBriefStore } from "./testSupport/inMemoryMissionSalesBriefStore";
import { writeClairePreDriveBrief, writeClaireOutcomeConfirmation } from "../claire/reasoning";
import type { ClaireDriveContext } from "../claire/contextAssembler";

function mockLLMStrategy(payload: Record<string, unknown>) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] };
}

function baseMission(): CommercialMission {
  return {
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
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    completedAt: null,
  } as unknown as CommercialMission;
}

describe("Claire Pass 2 — the one true end-to-end loop", () => {
  beforeEach(() => {
    setMissionSalesBriefStoreForTesting(createInMemoryMissionSalesBriefStore());
    vi.clearAllMocks();
  });
  afterEach(() => {
    setMissionSalesBriefStoreForTesting(null);
  });

  it("prior interest + unknown blocker -> v1 -> real outcome -> v2 -> Claire reflects v2, v1 untouched", async () => {
    // 1) Evidence for v1: prior interest known, no visit outcome yet — the blocker is unknown.
    mocks.assembleMissionSalesBriefEvidence.mockResolvedValueOnce({
      tenantId: "tenant-1",
      missionId: 1,
      accountId: 7,
      mission: baseMission(),
      currentVisitOutcome: null,
      priorOutcomes: [],
      knownFacts: [
        {
          text: "Management previously showed interest.",
          provenance: "authoritative_evidence",
          sourceReference: "commercial_missions:1:opportunity",
        },
      ],
      evidenceThrough: "2026-01-01T00:00:00.000Z",
    } satisfies MissionSalesBriefEvidence);

    mocks.invokeLLM.mockResolvedValueOnce(
      mockLLMStrategy({
        primaryObjective: "Learn what stopped this from moving forward, rather than pitching from zero.",
        recommendedOpening: null,
        questionsToAsk: ["What stopped this from moving forward?"],
        actionsToTake: [],
        thingsToAvoid: ["Repeating the introductory pitch."],
        successDefinition: "The real blocker is identified.",
        unknowns: [{ question: "Why has this stalled?", reason: "No objection or blocker is recorded yet." }],
      })
    );

    const v1 = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    expect(v1?.version).toBe(1);
    expect(v1?.supersedesVersion).toBeNull();
    expect(v1?.unknowns[0]?.question).toMatch(/stalled/i);

    // 2) Claire and FIELD both read v1 — same artifact.
    const claireV1 = toCompactMissionSalesBriefForClaire(v1!);
    const fieldV1 = toFieldMissionSalesBrief(v1!);
    expect(claireV1.briefId).toBe(fieldV1.briefId);
    expect(claireV1.version).toBe(fieldV1.version);

    const preDriveContext: ClaireDriveContext = {
      phase: "pre_drive",
      generatedAt: new Date().toISOString(),
      businessDate: "2026-01-01",
      actorId: "operator-1",
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
      missionSalesBrief: claireV1,
    };
    const invokeTextV1 = vi.fn().mockResolvedValue("Ask what stopped it. Don't re-pitch.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context: preDriveContext },
      { invokeText: invokeTextV1, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const v1Payload = JSON.parse(invokeTextV1.mock.calls[0][0].messages[1].content);
    expect(v1Payload.missionSalesBrief.briefId).toBe(v1!.id);
    expect(v1Payload.missionSalesBrief.version).toBe(1);

    // 3) A real, operator-attested outcome is confirmed: corporate approval is required.
    //    (This is what claireTwilio.ts's CONFIRM_PATH does for real via
    //    recordCommercialMissionVisitOutcome — that write is exercised in
    //    that module's own integration surface; here we prove the brief
    //    side reacts correctly to new authoritative evidence.)
    mocks.assembleMissionSalesBriefEvidence.mockResolvedValueOnce({
      tenantId: "tenant-1",
      missionId: 1,
      accountId: 7,
      mission: { ...baseMission(), status: "follow_up" },
      currentVisitOutcome: {
        outcome: "follow_up",
        notes: "Dana said corporate has to approve every resident vendor.",
        decisionMakerStatus: "met",
        followUpAt: null,
      },
      priorOutcomes: [],
      knownFacts: [
        {
          text: "Management previously showed interest.",
          provenance: "authoritative_evidence",
          sourceReference: "commercial_missions:1:opportunity",
        },
        {
          text: "This mission's own visit already recorded: a follow-up was requested. Dana said corporate has to approve every resident vendor.",
          provenance: "operator_attested",
          sourceReference: "commercial_visit_outcomes:1",
        },
      ],
      evidenceThrough: "2026-01-02T00:00:00.000Z", // advanced past v1's watermark
    } satisfies MissionSalesBriefEvidence);

    mocks.invokeLLM.mockResolvedValueOnce(
      mockLLMStrategy({
        primaryObjective: "Identify the corporate approval path and the decision maker who owns it.",
        recommendedOpening: null,
        questionsToAsk: ["Who at corporate approves new vendors?"],
        actionsToTake: [],
        thingsToAvoid: ["Repeating the introductory pitch.", "Re-asking whether they're interested — that's settled."],
        successDefinition: "The corporate approver and process are identified.",
        unknowns: [],
      })
    );

    // 4) Requesting the current brief now yields an immutable v2.
    const v2 = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    expect(v2?.version).toBe(2);
    expect(v2?.supersedesVersion).toBe(1);
    expect(v2?.recommendedApproach.primaryObjective).toMatch(/corporate approval/i);
    expect(v2?.knownFacts.some(fact => fact.text.includes("corporate"))).toBe(true);

    // v1 remains exactly as generated — no retroactive rewrite.
    expect(v1?.version).toBe(1);
    expect(v1?.recommendedApproach.primaryObjective).toMatch(/learn what stopped/i);

    // Wording-only re-request with no new evidence does NOT bump the version again.
    mocks.assembleMissionSalesBriefEvidence.mockResolvedValueOnce({
      tenantId: "tenant-1",
      missionId: 1,
      accountId: 7,
      mission: { ...baseMission(), status: "follow_up" },
      currentVisitOutcome: {
        outcome: "follow_up",
        notes: "Dana said corporate has to approve every resident vendor.",
        decisionMakerStatus: "met",
        followUpAt: null,
      },
      priorOutcomes: [],
      knownFacts: v2!.knownFacts,
      evidenceThrough: "2026-01-02T00:00:00.000Z", // unchanged watermark
    } satisfies MissionSalesBriefEvidence);
    const v2Again = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    expect(v2Again?.version).toBe(2);
    expect(mocks.invokeLLM).toHaveBeenCalledTimes(2); // never recompiled a third time

    // 5) Claire's subsequent guidance reflects v2, and can say why it changed.
    const claireV2 = toCompactMissionSalesBriefForClaire(v2!);
    const fieldV2 = toFieldMissionSalesBrief(v2!);
    expect(claireV2.briefId).toBe(fieldV2.briefId);
    expect(claireV2.version).toBe(2);

    const invokeTextV2 = vi.fn().mockResolvedValue("Find the corporate approver before anything else.");
    await writeClairePreDriveBrief(
      {
        tenantId: "tenant-1",
        context: { ...preDriveContext, missionSalesBrief: claireV2 },
      },
      { invokeText: invokeTextV2, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const v2Payload = JSON.parse(invokeTextV2.mock.calls[0][0].messages[1].content);
    expect(v2Payload.missionSalesBrief.version).toBe(2);
    expect(v2Payload.missionSalesBrief.primaryObjective).toMatch(/corporate approval/i);

    const invokeTextConfirmation = vi.fn().mockResolvedValue(
      "Confirmed. Now we know it's corporate approval, so the next move changes."
    );
    const confirmation = await writeClaireOutcomeConfirmation(
      {
        tenantId: "tenant-1",
        operatorUserId: "operator-1",
        outcome: "follow_up",
        outcomeLabel: "a follow-up was requested",
        strategyChange: {
          previousObjective: v1!.recommendedApproach.primaryObjective,
          newObjective: v2!.recommendedApproach.primaryObjective,
          newlyKnown: v2!.knownFacts
            .filter(fact => !v1!.knownFacts.some(prior => prior.text === fact.text))
            .map(fact => fact.text),
        },
      },
      { invokeText: invokeTextConfirmation, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(confirmation).toMatch(/corporate approval/i);
    const confirmationSystemPrompt = invokeTextConfirmation.mock.calls[0][0].messages[0].content;
    expect(confirmationSystemPrompt).toMatch(/strategyChange/i);
    const confirmationPayload = JSON.parse(invokeTextConfirmation.mock.calls[0][0].messages[1].content);
    expect(confirmationPayload.strategyChange.newlyKnown.join(" ")).toMatch(/corporate/i);
  });
});
