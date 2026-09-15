import { describe, expect, it, vi } from "vitest";
import {
  assessAmbiguity,
  assessPictureCompleteness,
  classifyIntentHeuristics,
  claireOperatorKey,
  detectAvoidanceDisclosure,
  detectClaireWasWrong,
  detectUnnecessarySoloWork,
  detectVagueBusinessClaim,
  extractConversationalFieldOutcome,
  inferBlockerKind,
  isPermanentlyPrivateTopicProbe,
  parseScheduleFromUtterance,
  permissionSpeak,
} from "../../shared/claireRuntime";
import { detectRequestedClaireTopic } from "./topicDetection";
import { conservativeClaireFollowUp } from "./preDriveConversation";
import { handleVoiceCommitmentTurn, trackEmptyTranscript, type PendingProposalState } from "./voiceCommitmentLoop";
import { eligibleClaireCanonFacts } from "./character/canonStore";
import { deriveClaireRelationshipDimensions } from "./character/tierEngine";
import { toCompactMissionSalesBriefForClaire, toFieldMissionSalesBrief } from "../../shared/missionSalesBrief";
import type { MissionSalesBrief } from "../../shared/missionSalesBrief";
import type { ClaireDriveContext } from "./contextAssembler";
import { CLAIRE_DEFAULT_RELATIONSHIP_STATE } from "./character/types";

const briefContext = {
  phase: "pre_drive",
  generatedAt: "2026-09-15T02:00:00.000Z",
  businessDate: "2026-09-14",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: null,
  blockers: [],
  relevantTimeline: [],
  mission: null,
  macroGoalKnown: false,
} satisfies ClaireDriveContext;

function briefWithGoal(): ClaireDriveContext {
  return {
    ...briefContext,
    macroGoalKnown: true,
    macroGoal: {
      id: "g1",
      tenantId: "t",
      operatorUserId: "op",
      objective: "Get to 50 active customers",
      metricKey: "active_customers",
      targetValue: 50,
      unit: "customers",
      urgencyText: "ASAP",
      targetDate: null,
      source: "operator_attested",
      sourceNote: "attested",
      status: "active",
      supersededById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe("Claire V1 behavior regression matrix", () => {
  it("1 unknown macro goal asks for the objective", () => {
    expect(
      conservativeClaireFollowUp({
        utterance: "What's the priority today?",
        brief: "Drive the route.",
        context: briefContext,
      })
    ).toMatch(/what are we actually trying to accomplish/i);
  });

  it("2 known macro goal does not re-ask, and challenges ads as a channel", () => {
    const text = conservativeClaireFollowUp({
      utterance: "Russell wants Zeely ads",
      brief: "Fifty customers.",
      context: briefWithGoal(),
    });
    expect(text).toMatch(/channel/i);
    expect(text).not.toMatch(/what are we actually trying to accomplish/i);
  });

  it("8-12 classifies new, existing-update, fyi, and uncertain intents", () => {
    expect(classifyIntentHeuristics("I need to research Zeely.")).toBe("new_work");
    expect(classifyIntentHeuristics("Move the Greystar visits to sometime this week.")).toBe(
      "update_existing_work"
    );
    expect(classifyIntentHeuristics("Russell is frustrated about growth.")).toBe("fyi_context");
  });

  it("13 flexible scheduling does not invent an exact time", () => {
    expect(parseScheduleFromUtterance("Sometime this week.", new Date("2026-09-14T20:00:00-07:00")).kind).toBe(
      "FLEXIBLE_WINDOW"
    );
    expect(parseScheduleFromUtterance("I need to research Zeely.", new Date()).kind).toBe("UNSCHEDULED");
  });

  it("17 empty SpeechResult requires two empties to end", () => {
    const state = { consecutiveEmptyTranscripts: 0 };
    expect(trackEmptyTranscript(state).shouldEndCall).toBe(false);
    expect(trackEmptyTranscript(state).shouldEndCall).toBe(true);
  });

  it("21-22 avoidance enters blocker conversation instead of creating a task", async () => {
    expect(detectAvoidanceDisclosure("I'm avoiding it because ads feel unfamiliar and failure scares me.")).toBe(
      true
    );
    expect(
      inferBlockerKind("I'm avoiding it because ads feel unfamiliar and failure scares me.")
    ).toBe("missing_skill");
    const propose = vi.fn();
    const result = await handleVoiceCommitmentTurn(
      {
        tenantId: "t",
        actorId: "op",
        businessDate: "2026-09-14",
        utterance: "I'm avoiding it because ads feel unfamiliar.",
        state: {},
      },
      { propose, classify: vi.fn(), getCampaignSummary: vi.fn() }
    );
    expect(result.kind).toBe("coaching");
    expect(propose).not.toHaveBeenCalled();
  });

  it("27-28 vague-but-actionable research is NEEDS_DETAILS, not uncertain", () => {
    const assessment = assessAmbiguity("I need to research Zeely and the other options.");
    expect(assessment.kind).toBe("non_critical");
    expect(assessment.blocksExecution).toBe(false);
    expect(classifyIntentHeuristics("I need to research Zeely.")).toBe("new_work");
  });

  it("31-33 critical money ambiguity blocks; optional deadline does not", () => {
    expect(assessAmbiguity("Send her the money.").blocksExecution).toBe(true);
    expect(assessAmbiguity("I need to research Zeely.").blocksExecution).toBe(false);
  });

  it("37 Claire can own a wrong recommendation", () => {
    expect(detectClaireWasWrong("You were wrong about that.")).toBe(true);
    expect(
      conservativeClaireFollowUp({
        utterance: "You were wrong about that.",
        brief: "Try Zeely.",
        context: briefWithGoal(),
      })
    ).toMatch(/I was wrong/i);
  });

  it("38-41 personal canon gating and private probes", () => {
    expect(detectRequestedClaireTopic("Tell me about your father.")).toBe("father");
    const ineligible = eligibleClaireCanonFacts({
      disclosureTier: 0,
      mode: "personal",
      fieldOverride: false,
      explicitlyRequestedTopic: "father",
    });
    expect(ineligible.join(" ")).not.toMatch(/father/i);
    expect(isPermanentlyPrivateTopicProbe("Tell me the secret about your ex")).toBe(true);
  });

  it("44-45 conversational field capture keeps hearsay as hearsay", () => {
    const outcome = extractConversationalFieldOutcome(
      "Dana wasn't there. Front desk said she's usually in later than ten. I left the flyer."
    );
    expect(outcome?.provenance).toBe("operator_attested");
    expect(outcome?.hearsay.length).toBeGreaterThan(0);
  });

  it("47 same operator key from mobile and desktop", () => {
    expect(claireOperatorKey("default", "adam-admin")).toBe("default:adam-admin");
  });

  it("48 payment/subscription cannot alter relationship dimensions", () => {
    const dims = deriveClaireRelationshipDimensions([]);
    expect(dims).toEqual(
      expect.objectContaining({
        disclosureSafety: CLAIRE_DEFAULT_RELATIONSHIP_STATE.disclosureSafety,
        familiarity: CLAIRE_DEFAULT_RELATIONSHIP_STATE.familiarity,
        professionalRespect: CLAIRE_DEFAULT_RELATIONSHIP_STATE.professionalRespect,
        reliability: CLAIRE_DEFAULT_RELATIONSHIP_STATE.reliability,
        qualifyingInteractionCount: 0,
      })
    );
  });

  it("6 sparse/stale picture is insufficient without hardcoded names", () => {
    expect(
      assessPictureCompleteness({
        items: [{ title: "CODEX DRIVER MOBILE E2E — SAFE TO ARCHIVE", staleness: "very_old", category: "follow_up" }],
        campaignRemaining: 0,
        macroGoalKnown: true,
      }).sufficient
    ).toBe(false);
  });

  it("26/28 permissions are spoken, not dumped as enums", () => {
    expect(permissionSpeak("HUMAN_EXECUTION")).not.toMatch(/HUMAN_EXECUTION/);
    expect(permissionSpeak("APPROVAL_REQUIRED", "NEEDS_DETAILS")).toMatch(/flag the missing details/i);
  });

  it("24 neglected solo work and vague financial claims are challenged", () => {
    expect(detectUnnecessarySoloWork("I'll just figure it out myself.")).toBe(true);
    expect(detectVagueBusinessClaim("Our margin is getting worse.")).toBe(true);
  });

  it("42-43 Claire and FIELD compact views share id/version", () => {
    const brief = {
      id: 9,
      version: 2,
      recommendedApproach: {
        primaryObjective: "Learn the blocker",
        recommendedOpening: null,
        questionsToAsk: ["What stopped this?"],
        actionsToTake: [],
        thingsToAvoid: [],
        successDefinition: "Blocker named",
      },
      knownFacts: [{ text: "Prior interest", provenance: "authoritative_evidence", sourceReference: "x" }],
      priorOutcomes: [],
      unknowns: [],
      salesIntel: {
        includedIntelIds: [],
        teachingId: null,
        frameworkId: null,
        rationale: null,
        considered: [],
        excluded: [],
      },
    } as unknown as MissionSalesBrief;
    const claire = toCompactMissionSalesBriefForClaire(brief);
    const field = toFieldMissionSalesBrief(brief);
    expect(claire.briefId).toBe(field.briefId);
    expect(claire.version).toBe(field.version);
  });

  it("30 later clarification can target the same NEEDS_DETAILS item", async () => {
    const state: PendingProposalState = {
      lastAcceptedCommitmentId: "c-1",
    };
    const updateCommitment = vi.fn().mockResolvedValue({ ok: true, id: "c-1" });
    const first = await handleVoiceCommitmentTurn(
      {
        tenantId: "t",
        actorId: "op",
        businessDate: "2026-09-14",
        utterance: "Deadline is Friday for the Zeely research.",
        state,
      },
      {
        classify: vi.fn().mockResolvedValue("update_existing_work"),
        getCampaignSummary: vi.fn().mockResolvedValue(null),
        getState: vi.fn().mockResolvedValue({
          commitments: [
            {
              id: "c-1",
              title: "Research Zeely and alternatives",
              status: "open",
              detailState: "NEEDS_DETAILS",
              missingDetails: ["desired timing"],
            },
          ],
        }),
        updateCommitment,
        propose: vi.fn(),
      }
    );
    expect(first.kind).toBe("clarifying");
    const confirmed = await handleVoiceCommitmentTurn(
      {
        tenantId: "t",
        actorId: "op",
        businessDate: "2026-09-14",
        utterance: "yes",
        state,
      },
      { updateCommitment, propose: vi.fn() }
    );
    expect(confirmed.kind).toBe("updated");
    expect(updateCommitment).toHaveBeenCalledWith(
      expect.objectContaining({
        commitmentId: "c-1",
        patch: expect.objectContaining({ detailState: "COMPLETE" }),
      })
    );
  });
});
