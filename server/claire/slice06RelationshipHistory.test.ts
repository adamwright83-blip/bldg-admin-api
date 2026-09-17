import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateHumanApproval } from "../agents/humanApproval";
import type { AgentContext } from "../agents/permissions";
import {
  assembleClaireRelationshipHistory,
  containsForbiddenHistoryClaim,
} from "../../shared/claireRelationshipHistory";
import { AssertionGuard, VerifiedFactInventoryBuilder } from "./assertionGuard";
import { compileClaireCharacterContext } from "./character/compiler";
import { composeClaireRelationshipClosing } from "./character/relationshipOffboarding";
import {
  isWarmthEmissionAllowed,
  recordClaireMissionOutcomeEvents,
  WARMTH_EMISSION_ALLOWLIST,
} from "./character/relationshipEmitters";
import { compileClaireContextForOperator } from "./character/relationshipHistory";
import { getClaireRelationshipState } from "./character/relationshipState";
import { setClaireRelationshipStoreForTesting } from "./character/store";
import { createInMemoryClaireStore } from "./character/testSupport/inMemoryClaireStore";
import { CLAIRE_DEFAULT_RELATIONSHIP_STATE } from "./character/types";
import { writeClairePreDriveBrief } from "./reasoning";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { buildClaireVerifiedFactInventory } from "./verifiedFactInventoryFromContext";
import type { ClaireDriveContext } from "./contextAssembler";

const tenantId = "tenant-slice6";
const operatorUserId = "operator-slice6";

const baseState = {
  tenantId,
  operatorUserId,
  characterId: "claire" as const,
  updatedAt: new Date().toISOString(),
  ...CLAIRE_DEFAULT_RELATIONSHIP_STATE,
};

const driveContext: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: "2026-09-14T12:00:00.000Z",
  businessDate: "2026-09-14",
  actorId: operatorUserId,
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: {
    id: "visit-42",
    kind: "commercial_visit",
    title: "The Wilshire",
    subtitle: "Commercial visit",
    urgency: "today",
    scheduledAt: "2026-09-14T17:00:00.000Z",
    destination: "100 Wilshire Boulevard",
    sourceReference: "commercial_missions:42",
    whySurfaced: "scheduled",
    actions: [],
  },
  blockers: [],
  relevantTimeline: [],
  mission: null,
};

describe("Slice 6 production relationship history", () => {
  beforeEach(() => {
    setClaireRelationshipStoreForTesting(createInMemoryClaireStore());
  });
  afterEach(() => {
    setClaireRelationshipStoreForTesting(null);
  });

  it("9 — model-generated text cannot create a relationship event by itself", () => {
    const reasoning = readFileSync(new URL("./reasoning.ts", import.meta.url), "utf8");
    const preDrive = readFileSync(new URL("./preDriveConversation.ts", import.meta.url), "utf8");
    const compiler = readFileSync(new URL("./character/compiler.ts", import.meta.url), "utf8");
    const assembler = readFileSync(
      new URL("../../shared/claireRelationshipHistory.ts", import.meta.url),
      "utf8"
    );
    for (const source of [reasoning, preDrive, compiler, assembler]) {
      expect(source).not.toMatch(/appendClaireRelationshipEvent/);
      expect(source).not.toMatch(/recordClaireMissionOutcomeEvents/);
      expect(source).not.toMatch(/recordQualifyingClaireInteraction/);
    }
  });

  it("10 — accepting or selecting a mission does not increase warmth", () => {
    expect(
      isWarmthEmissionAllowed({
        eventType: "operator_follow_through",
        summary: "Accepted mission proposal",
      })
    ).toBe(false);
    expect(
      isWarmthEmissionAllowed({
        eventType: "path_choice",
        summary: "Operator selected the recommended path",
      })
    ).toBe(false);
  });

  it("11 — verified follow-through may influence allowed relationship state", async () => {
    await recordClaireMissionOutcomeEvents({
      tenantId,
      operatorUserId,
      missionId: 88,
      outcome: "won",
      occurredAt: new Date("2026-01-02T12:00:00.000Z"),
    });
    const state = await getClaireRelationshipState({ tenantId, operatorUserId });
    expect(state.professionalRespect).toBeGreaterThan(0);
    expect(state.reliability).toBeGreaterThan(0);
    expect(WARMTH_EMISSION_ALLOWLIST.has("operator_follow_through")).toBe(true);
  });

  it("12 — relationship familiarity does not bypass human approval", () => {
    const ctx: AgentContext = {
      tenantId,
      agentType: "gm_agent",
      actorType: "ai_agent",
      approvedByUserId: null,
    };
    const denied = evaluateHumanApproval(ctx, "sendCustomerReminderTool");
    expect(denied.allowed).toBe(false);
    expect(denied.requiresHumanApproval).toBe(true);
    expect(evaluateHumanApproval({ ...ctx }, "sendCustomerReminderTool").allowed).toBe(false);
  });

  it("13 — historical scheduled memory cannot present as current when inventory disagrees", () => {
    const inventory = new VerifiedFactInventoryBuilder().build();
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      relationshipEvents: [
        {
          id: 21,
          tenantId,
          operatorUserId,
          eventType: "operator_follow_through",
          summary: "The Wilshire visit is scheduled for Friday.",
          provenance: "stale_memory",
          relatedEntityType: "commercial_visit",
          relatedEntityId: "visit-99",
          evidenceSource: "relationship_event",
          occurredAt: "2026-01-01T12:00:00.000Z",
        },
      ],
      truthLookup: {
        supportsCurrentClaim: (claimedState, entityRef) =>
          inventory.hasVerifiedClaim(claimedState as "scheduled", entityRef),
      },
    });
    expect(history.items[0]?.temporalFrame).toBe("current_unverified");
    expect(history.items[0]?.statement).toMatch(/not current verified state/i);
    expect(AssertionGuard.verifyClaim({ claimedState: "scheduled", entityRef: "visit-99" })).toBe(
      "unknown"
    );
  });

  it("19 — disclosure remains fail-closed if relationship storage fails", async () => {
    setClaireRelationshipStoreForTesting({
      async appendEvent() {
        throw new Error("db down");
      },
      async listEvents() {
        throw new Error("db down");
      },
      async getState() {
        throw new Error("db down");
      },
      async upsertState() {
        throw new Error("db down");
      },
      async insertTierTransition() {
        throw new Error("db down");
      },
      async listTierTransitions() {
        throw new Error("db down");
      },
    });
    const compiled = await compileClaireContextForOperator({
      tenantId,
      operatorUserId,
      mode: "casual",
    });
    expect(compiled.disclosureTier).toBe(0);
    expect(compiled.sharedHistorySummaries).toEqual([]);
  });

  it("20 — operator_avoidance remains disabled", () => {
    expect(WARMTH_EMISSION_ALLOWLIST.has("operator_avoidance")).toBe(false);
    expect(
      isWarmthEmissionAllowed({
        eventType: "operator_avoidance",
        summary: "Operator avoided the stop",
        provenance: "inferred",
      })
    ).toBe(false);
    const emitters = readFileSync(
      new URL("./character/relationshipEmitters.ts", import.meta.url),
      "utf8"
    );
    expect(emitters).not.toMatch(/eventType:\s*"operator_avoidance"/);
  });

  it("22/23/24 — offboarding uses eligible history, preserves business records, and claims no feelings", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      relationshipEvents: [
        {
          id: 3,
          tenantId,
          operatorUserId,
          eventType: "shared_hard_win",
          summary: "Won mission 3 — confirmed business outcome.",
          provenance: "debrief_confirm",
          relatedEntityType: "commercial_mission",
          relatedEntityId: "3",
          evidenceSource: "debrief_confirm",
          occurredAt: "2026-02-01T12:00:00.000Z",
        },
      ],
      declaredPreferences: [
        {
          statement: "You told me mornings are better for calls.",
          occurredAt: "2026-02-02T12:00:00.000Z",
        },
      ],
      inferences: [
        {
          statement: "Is timing getting in the way?",
          occurredAt: "2026-02-03T12:00:00.000Z",
          topicKeys: ["other"],
        },
      ],
    });
    const closing = composeClaireRelationshipClosing({ tenantId, operatorUserId, history });
    expect(closing.mutatesBusinessRecords).toBe(false);
    expect(closing.businessRecords).toBe("preserved");
    expect(closing.relationshipContinuity).toBe("stopped");
    expect(closing.closingMessage).toContain("Won mission 3");
    expect(closing.closingMessage).toContain("mornings are better");
    expect(closing.closingMessage).not.toContain("Is timing getting in the way?");
    expect(closing.closingMessage.toLowerCase()).not.toContain("claire feels");
    expect(containsForbiddenHistoryClaim(closing.closingMessage)).toBe(false);
  });

  it("compiler stays inside the prompt history budget and labels epistemic class", () => {
    const history = assembleClaireRelationshipHistory({
      tenantId,
      operatorUserId,
      relationshipEvents: [
        {
          id: 55,
          tenantId,
          operatorUserId,
          eventType: "operator_follow_through",
          summary: "Confirmed a real visit outcome for mission 55.",
          provenance: "debrief_confirm",
          relatedEntityType: "commercial_mission",
          relatedEntityId: "55",
          evidenceSource: "debrief_confirm",
          occurredAt: "2026-03-01T12:00:00.000Z",
        },
      ],
    });
    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: baseState,
      recentSharedHistory: [],
      assembledHistory: history,
    });
    expect(compiled.sharedHistorySummaries.length).toBeLessThanOrEqual(5);
    expect(compiled.sharedHistorySummaries.join(" ")).toMatch(/verified-shared/);
    expect(compiled.promptSection).toMatch(/Current verified business truth outranks/);
    expect(compiled.version.compilerVersion).toBe("claire-runtime-4");
  });

  it("production pre-drive brief and follow-up consume the assembler contract", async () => {
    await recordClaireMissionOutcomeEvents({
      tenantId,
      operatorUserId,
      missionId: 42,
      outcome: "lost",
      occurredAt: new Date("2026-03-02T12:00:00.000Z"),
    });
    const invokeText = vi.fn().mockResolvedValue("Keep the Wilshire stop first.");
    await writeClairePreDriveBrief(
      { tenantId, context: driveContext },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const briefPrompt = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(briefPrompt).toMatch(/verified-shared|Durable shared history|Current verified business truth/);

    invokeText.mockResolvedValueOnce("The Wilshire stop is still first.");
    await answerClairePreDriveFollowUp(
      {
        tenantId,
        utterance: "What is first?",
        brief: "Keep the Wilshire stop first.",
        context: driveContext,
      },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const followPrompt = invokeText.mock.calls[1][0].messages[0].content as string;
    expect(followPrompt).toMatch(/Current verified business truth outranks/);
  });

  it("25 — existing assertion-guard inventory still verifies scheduled Field Today items", () => {
    const inventory = buildClaireVerifiedFactInventory(driveContext);
    expect(inventory.hasVerifiedClaim("scheduled", "visit-42")).toBe(true);
    expect(inventory.hasVerifiedClaim("sent")).toBe(false);
  });
});
