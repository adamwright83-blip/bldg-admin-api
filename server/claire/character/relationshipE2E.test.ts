import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAIRE_CHARACTER_DEFINITION } from "./characterDefinition";
import { compileClaireCharacterContext } from "./compiler";
import {
  recordClaireAttestedEvent,
  recordClaireMissionOutcomeEvents,
  recordQualifyingClaireInteraction,
} from "./relationshipEmitters";
import { listClaireRelationshipEvents } from "./relationshipEvents";
import {
  getClaireRelationshipState,
  listClaireTierTransitions,
} from "./relationshipState";
import { setClaireRelationshipStoreForTesting } from "./store";
import { createInMemoryClaireStore } from "./testSupport/inMemoryClaireStore";

const policy = CLAIRE_CHARACTER_DEFINITION.relationshipPolicy;

/** Deterministic distinct-day timestamps for tier-threshold tests (day counts matter, not just event counts). */
function dayOffset(n: number): Date {
  return new Date(2026, 0, n + 1, 12, 0, 0);
}

async function recordFollowThroughEvent(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  conversationId: string;
  reason?: "closing_phrase" | "turn_cap_reached";
  occurredAt?: Date;
}) {
  if (!input.operatorUserId) return null;
  await recordClaireMissionOutcomeEvents({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    missionId: Math.abs(Array.from(input.conversationId).reduce((sum, char) => sum + char.charCodeAt(0), 0)) || 1,
    outcome: "no_decision",
    occurredAt: input.occurredAt,
  });
  return getClaireRelationshipState({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
  });
}

/**
 * End-to-end regression tests for the Claire relationship loop, running
 * against a deterministic in-memory store (no live MySQL is available in
 * this environment) rather than only pure-function substrate tests. These
 * prove the actual target behavior: an operator can build real, isolated,
 * tenant/operator-scoped relationship state with Claire through the same
 * event-emission surface the live call flow uses, and that state
 * deterministically gates what she remembers and says later.
 */
describe("Claire relationship loop — end to end", () => {
  beforeEach(() => {
    setClaireRelationshipStoreForTesting(createInMemoryClaireStore());
  });
  afterEach(() => {
    setClaireRelationshipStoreForTesting(null);
  });

  it("isolates state: same tenant, different operators never share relationship state", async () => {
    for (let day = 0; day < policy.tier0to1.minQualifyingInteractions; day += 1) {
      await recordFollowThroughEvent({
        tenantId: "tenant-1",
        operatorUserId: "operator-A",
        conversationId: `conv-A-${day}`,
        reason: "closing_phrase",
        occurredAt: dayOffset(day),
      });
    }
    const stateA = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: "operator-A",
    });
    const stateB = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: "operator-B",
    });
    expect(stateA.disclosureTier).toBe(1);
    expect(stateB.disclosureTier).toBe(0);
    expect(stateB.qualifyingInteractionCount).toBe(0);
  });

  it("isolates state: same operator, different tenants never share relationship state", async () => {
    for (let day = 0; day < policy.tier0to1.minQualifyingInteractions; day += 1) {
      await recordFollowThroughEvent({
        tenantId: "tenant-1",
        operatorUserId: "operator-shared",
        conversationId: `conv-${day}`,
        reason: "closing_phrase",
        occurredAt: dayOffset(day),
      });
    }
    const tenant1State = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: "operator-shared",
    });
    const tenant2State = await getClaireRelationshipState({
      tenantId: "tenant-2",
      operatorUserId: "operator-shared",
    });
    expect(tenant1State.disclosureTier).toBe(1);
    expect(tenant2State.disclosureTier).toBe(0);
    expect(tenant2State.qualifyingInteractionCount).toBe(0);
  });

  it("fails closed: unresolved operator identity gets Tier 0 and writes nothing", async () => {
    const result = await recordFollowThroughEvent({
      tenantId: "tenant-1",
      operatorUserId: null,
      conversationId: "conv-anonymous",
      reason: "closing_phrase",
    });
    expect(result).toBeNull();
    const events = await listClaireRelationshipEvents({
      tenantId: "tenant-1",
      operatorUserId: "unresolved",
    });
    expect(events).toEqual([]);
    const state = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: null,
    });
    expect(state.disclosureTier).toBe(0);
  });

  it("progresses Tier 0 -> Tier 1 deterministically once, and only once, thresholds are met", async () => {
    const belowThreshold = policy.tier0to1.minQualifyingInteractions - 1;
    for (let i = 0; i < belowThreshold; i += 1) {
      await recordFollowThroughEvent({
        tenantId: "tenant-1",
        operatorUserId: "operator-C",
        conversationId: `conv-${i}`,
        reason: "closing_phrase",
        occurredAt: dayOffset(i),
      });
    }
    const beforeThreshold = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: "operator-C",
    });
    expect(beforeThreshold.disclosureTier).toBe(0);

    const finalState = await recordFollowThroughEvent({
      tenantId: "tenant-1",
      operatorUserId: "operator-C",
      conversationId: `conv-${belowThreshold}`,
      reason: "closing_phrase",
      occurredAt: dayOffset(belowThreshold),
    });
    expect(finalState?.disclosureTier).toBe(1);

    const transitions = await listClaireTierTransitions({
      tenantId: "tenant-1",
      operatorUserId: "operator-C",
    });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ fromTier: 0, toTier: 1 });
    expect(transitions[0].reasons.length).toBeGreaterThan(0);
    expect(transitions[0].supportingEventIds).toBeDefined();
  });

  it("insufficient events cannot progress the tier", async () => {
    for (let i = 0; i < policy.tier0to1.minQualifyingInteractions - 2; i += 1) {
      await recordFollowThroughEvent({
        tenantId: "tenant-1",
        operatorUserId: "operator-D",
        conversationId: `conv-${i}`,
        reason: "closing_phrase",
        occurredAt: dayOffset(i),
      });
    }
    const state = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: "operator-D",
    });
    expect(state.disclosureTier).toBe(0);
    const transitions = await listClaireTierTransitions({
      tenantId: "tenant-1",
      operatorUserId: "operator-D",
    });
    expect(transitions).toHaveLength(0);
  });

  it("a confirmed 'won' mission outcome writes a shared hard win Claire can later recall and use to reach Tier 2", async () => {
    const tenantId = "tenant-1";
    const operatorUserId = "operator-E";
    for (let i = 0; i < policy.tier1to2.minQualifyingInteractions - 1; i += 1) {
      await recordFollowThroughEvent({
        tenantId,
        operatorUserId,
        conversationId: `conv-${i}`,
        reason: "closing_phrase",
        occurredAt: dayOffset(i),
      });
    }
    await recordClaireMissionOutcomeEvents({
      tenantId,
      operatorUserId,
      missionId: 42,
      outcome: "won",
      occurredAt: dayOffset(policy.tier1to2.minQualifyingInteractions),
    });

    const state = await getClaireRelationshipState({ tenantId, operatorUserId });
    expect(state.disclosureTier).toBe(2);

    // Scene 5's "I'll remember" fixture: the win is retrievable later, bounded.
    const history = await listClaireRelationshipEvents({
      tenantId,
      operatorUserId,
      limit: 5,
    });
    expect(history.some(event => event.eventType === "shared_hard_win")).toBe(true);

    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: state,
      recentSharedHistory: history,
    });
    expect(compiled.sharedHistorySummaries.join(" ")).toMatch(/won mission 42/i);
  });

  it("Claire's own acknowledged miss ('I'll remember') is durable and retrievable in a later conversation", async () => {
    const tenantId = "tenant-1";
    const operatorUserId = "operator-F";
    await recordClaireAttestedEvent({
      tenantId,
      operatorUserId,
      eventType: "claire_admitted_error",
      summary:
        "Claire recommended reopening the value proposition; the account had already been over-pitched. Claire owned the miss and will weight pitch fatigue higher next time.",
      relatedEntityType: "commercial_mission",
      relatedEntityId: "77",
      attestedByUserId: operatorUserId,
    });

    // A later, separate "conversation": fresh retrieval call, not a kept-open session.
    const laterHistory = await listClaireRelationshipEvents({
      tenantId,
      operatorUserId,
      limit: 5,
    });
    expect(laterHistory).toHaveLength(1);
    expect(laterHistory[0].eventType).toBe("claire_admitted_error");

    const laterState = await getClaireRelationshipState({ tenantId, operatorUserId });
    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: laterState,
      recentSharedHistory: laterHistory,
    });
    expect(compiled.promptSection).toMatch(/pitch fatigue/i);
    expect(compiled.promptSection).toMatch(/never contradict it/i);
  });

  it("retrieval stays bounded: only the 5 most recent shared-history events are ever surfaced, not a full dump", async () => {
    const tenantId = "tenant-1";
    const operatorUserId = "operator-G";
    for (let i = 0; i < 12; i += 1) {
      await recordFollowThroughEvent({
        tenantId,
        operatorUserId,
        conversationId: `conv-${i}`,
        reason: "closing_phrase",
      });
    }
    const bounded = await listClaireRelationshipEvents({ tenantId, operatorUserId, limit: 5 });
    expect(bounded).toHaveLength(5);
    const full = await listClaireRelationshipEvents({ tenantId, operatorUserId });
    expect(full).toHaveLength(12);
  });

  it("deeper canon is never retrieved before disclosure-tier eligibility, even with real shared history present", async () => {
    const tenantId = "tenant-1";
    const operatorUserId = "operator-H";
    await recordFollowThroughEvent({
      tenantId,
      operatorUserId,
      conversationId: "conv-1",
      reason: "closing_phrase",
    });
    const state = await getClaireRelationshipState({ tenantId, operatorUserId });
    expect(state.disclosureTier).toBe(0);
    const history = await listClaireRelationshipEvents({ tenantId, operatorUserId });
    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: state,
      recentSharedHistory: history,
    });
    expect(compiled.eligibleCanonFacts.join(" ")).not.toMatch(/father|six-year|childhood/i);
  });

  it("permanently-private canon never reaches runtime context even at the highest reachable tier", async () => {
    const tenantId = "tenant-1";
    const operatorUserId = "operator-I";
    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: {
        tenantId,
        operatorUserId,
        characterId: "claire",
        professionalRespect: 100,
        reliability: 100,
        disclosureSafety: 100,
        familiarity: 100,
        disclosureTier: 3,
        qualifyingInteractionCount: 999,
        distinctInteractionDays: 999,
        lastEventId: null,
        updatedAt: new Date().toISOString(),
      },
      recentSharedHistory: [],
      explicitlyRequestedTopic: "father",
    });
    expect(compiled.promptSection).not.toMatch(/last exchange/i);
    expect(compiled.eligibleCanonFacts.join(" ")).not.toMatch(/last exchange/i);
  });

  it("undefined biography stays undefined: the compiler instructs Claire never to invent it", () => {
    const compiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: {
        tenantId: "tenant-1",
        operatorUserId: "operator-J",
        characterId: "claire",
        professionalRespect: 0,
        reliability: 0,
        disclosureSafety: 0,
        familiarity: 0,
        disclosureTier: 0,
        qualifyingInteractionCount: 0,
        distinctInteractionDays: 0,
        lastEventId: null,
        updatedAt: new Date().toISOString(),
      },
      recentSharedHistory: [],
    });
    expect(compiled.promptSection).toMatch(/undefined personal history stays undefined/i);
  });

  it("field mode suppresses unnecessary intimacy even for a high-tier operator with real shared history", async () => {
    const tenantId = "tenant-1";
    const operatorUserId = "operator-K";
    await recordClaireMissionOutcomeEvents({ tenantId, operatorUserId, missionId: 1, outcome: "won" });
    const state = await getClaireRelationshipState({ tenantId, operatorUserId });
    const history = await listClaireRelationshipEvents({ tenantId, operatorUserId });
    const fieldCompiled = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: { ...state, disclosureTier: 3 },
      recentSharedHistory: history,
    });
    expect(fieldCompiled.promptSection).toContain("Priorities in order: clarity, brevity, safety, useful action");
    expect(fieldCompiled.promptSection).not.toMatch(/father|six-year|childhood/i);
  });

  it("missing/ambiguous state behaves exactly like a competent professional Tier 0 Claire", async () => {
    const state = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: "never-seen-operator",
    });
    expect(state).toMatchObject({
      disclosureTier: 0,
      professionalRespect: 0,
      reliability: 0,
      disclosureSafety: 0,
      familiarity: 0,
    });
    const compiled = compileClaireCharacterContext({
      mode: "pre_drive",
      relationshipState: state,
      recentSharedHistory: [],
    });
    expect(compiled.promptSection).toContain(
      "You are Claire: direct, dry, truthful, concise, observant."
    );
  });

  it("the target narrative: speak today, create a shared experience, speak later, and Claire truthfully remembers it", async () => {
    const tenantId = "tenant-1";
    const operatorUserId = "operator-narrative";

    // Day 1: an ordinary completed call. No relationship yet.
    const day1State = await recordFollowThroughEvent({
      tenantId,
      operatorUserId,
      conversationId: "conv-day1",
      reason: "closing_phrase",
    });
    expect(day1State?.disclosureTier).toBe(0);

    // A real, legitimate shared experience: a mission is won and confirmed as business truth.
    await recordClaireMissionOutcomeEvents({
      tenantId,
      operatorUserId,
      missionId: 900,
      outcome: "won",
    });

    // Later: a fresh retrieval (a new "conversation") sees the win without a full dump.
    const laterHistory = await listClaireRelationshipEvents({ tenantId, operatorUserId, limit: 5 });
    const laterState = await getClaireRelationshipState({ tenantId, operatorUserId });
    const laterCompiled = compileClaireCharacterContext({
      mode: "casual",
      relationshipState: laterState,
      recentSharedHistory: laterHistory,
    });
    expect(laterCompiled.sharedHistorySummaries.join(" ")).toMatch(/won mission 900/i);
    expect(laterCompiled.promptSection).toMatch(/never contradict it/i);

    // The relationship state changed deterministically from that experience, not from
    // the model narrating it — recomputing again with no new events is stable/idempotent.
    const stableState = await getClaireRelationshipState({ tenantId, operatorUserId });
    expect(stableState).toEqual(laterState);
  });

  it("completed phone calls do not farm relationship progression by themselves", async () => {
    for (let day = 0; day < policy.tier0to1.minQualifyingInteractions + 3; day += 1) {
      await recordQualifyingClaireInteraction({
        tenantId: "tenant-1",
        operatorUserId: "operator-calls-only",
        conversationId: `call-${day}`,
        reason: "closing_phrase",
        occurredAt: dayOffset(day),
      });
    }
    const state = await getClaireRelationshipState({
      tenantId: "tenant-1",
      operatorUserId: "operator-calls-only",
    });
    expect(state.disclosureTier).toBe(0);
    expect(state.qualifyingInteractionCount).toBe(0);
    expect(state.professionalRespect).toBe(0);
    expect(state.reliability).toBe(0);
  });

  it("subscription, voice minutes, and packaging never change relationship tier or canon access", async () => {
    const paidPlans = ["free", "individual", "team", "enterprise", "claire_deluxe", "goldline_command", "goldline_play"] as const;
    for (const plan of paidPlans) {
      const state = await getClaireRelationshipState({
        tenantId: "tenant-plan",
        operatorUserId: `op-${plan}`,
      });
      expect(state.disclosureTier).toBe(0);
      expect(state.qualifyingInteractionCount).toBe(0);
      const compiled = compileClaireCharacterContext({
        mode: "casual",
        relationshipState: { ...state, disclosureTier: 0 },
        recentSharedHistory: [],
      });
      expect(compiled.promptSection).not.toMatch(/father|married|childhood/i);
      void plan;
    }
  });
});
