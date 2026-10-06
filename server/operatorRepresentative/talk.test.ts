import { describe, expect, it } from "vitest";
import type { CanonicalOperatorIdentity } from "../persistentOperator/identity";
import type { OperatorContextPacket } from "../persistentOperator/operatorContext";
import { buildOperatorRepresentativeSnapshot } from "./readModel";
import { answerOperatorRepresentativeQuestion } from "./talk";

const identity: CanonicalOperatorIdentity = {
  tenantId: "t",
  canonicalOperatorId: "tenant:t:operator:op",
  canonicalOpenId: "op",
  canonicalUserId: 1,
  sourceOpenId: "op",
  sourceUserId: 1,
  sourceRole: "admin",
  dayDirectorActorId: "1",
  dayDirectorActorIds: ["1"],
  weeklyOperatorId: "op",
  campaignOperatorUserId: "op",
  communicationOperatorUserId: "op",
  membership: { source: "owner", canonical: "owner" },
  aliases: [],
};

function packet(withChannel = false): OperatorContextPacket {
  return {
    tenantId: "t",
    canonicalOperatorId: identity.canonicalOperatorId,
    generatedAt: "2026-10-04T18:00:00.000Z",
    mappedUserIds: ["1"],
    card: {
      explicitFacts: [],
      explicitPreferences: withChannel
        ? [
            {
              kind: "contact_channel",
              targetKey: "contact_channel",
              preference: "phone calls after 10 AM",
              sourceSystem: "operator_profile",
              provenance: "operator_declared",
              evidenceRefId: "ref-pref",
            },
          ]
        : [],
    },
    observedPatterns: [
      {
        kind: "intervention_start_sequence",
        observationCount: 3,
        distinctDecisionPointCount: 3,
        distinctCorrelationCount: 3,
        summary: "3 qualifying starts followed the tested intervention.",
        confidence: "descriptive",
        evidenceRefs: ["ref-pattern"],
      },
    ],
    learnedSignals: [
      {
        learningKind: "channel_affinity",
        targetKey: "opaque-arm-7",
        confidence: "high",
        deltaType: "reinforce",
        beforeState: null,
        afterState: {},
        evidenceReference: "outcome:7",
        sourceDeltaId: "delta-7",
        createdAt: "2026-10-04T17:00:00.000Z",
        evidenceRefId: "ref-delta",
      },
    ],
    interventionEvidence: [],
    uncertainty: [],
    evidenceRefs: [
      {
        id: "ref-pattern",
        sourceSystem: "behavioral_ledger",
        sourceRecordId: "10",
        tenantId: "t",
        operatorUserId: "1",
        canonicalOperatorId: identity.canonicalOperatorId,
        timestamp: "2026-10-04T16:00:00.000Z",
      },
      {
        id: "ref-delta",
        sourceSystem: "goal_cycle_learned_deltas",
        sourceRecordId: "delta-7",
        tenantId: "t",
        operatorUserId: "1",
        canonicalOperatorId: identity.canonicalOperatorId,
        timestamp: "2026-10-04T17:00:00.000Z",
      },
      ...(withChannel
        ? [
            {
              id: "ref-pref",
              sourceSystem: "operator_profile",
              sourceRecordId: "pref-1",
              tenantId: "t",
              operatorUserId: "1",
              canonicalOperatorId: identity.canonicalOperatorId,
              timestamp: "2026-10-04T15:00:00.000Z",
            },
          ]
        : []),
    ],
  };
}

function snapshot(withChannel = false) {
  return buildOperatorRepresentativeSnapshot({
    identity,
    packet: packet(withChannel),
    directives: [],
  });
}

describe("Operator Representative grounded Talk", () => {
  it("answers learning questions as descriptive evidence, not preferences", () => {
    const answer = answerOperatorRepresentativeQuestion({
      question: "What have you learned about me?",
      snapshot: snapshot(),
    });
    expect(answer.intent).toBe("learning");
    expect(answer.reply).toMatch(/descriptive patterns/i);
    expect(answer.reply).not.toMatch(/you prefer/i);
  });

  it("refuses to infer a communication channel from channel_affinity", () => {
    const answer = answerOperatorRepresentativeQuestion({
      question: "What communication channel do I prefer?",
      snapshot: snapshot(),
    });
    expect(answer.intent).toBe("channel");
    expect(answer.reply).toMatch(/don't have an authoritative declared/i);
    expect(answer.reply).toMatch(/won't infer one from channel_affinity or assignedOption/i);
  });

  it("may repeat an explicitly declared channel preference", () => {
    const answer = answerOperatorRepresentativeQuestion({
      question: "What communication channel do I prefer?",
      snapshot: snapshot(true),
    });
    expect(answer.reply).toContain("phone calls after 10 AM");
    expect(answer.itemRefs).toHaveLength(1);
  });

  it("requires an unambiguous focused item before mutating", () => {
    const answer = answerOperatorRepresentativeQuestion({
      question: "Don't use that.",
      snapshot: snapshot(),
    });
    expect(answer.intent).toBe("suppress");
    expect(answer.needsClarification).toBe(true);
    expect(answer).not.toHaveProperty("directiveRequest");
  });

  it("produces a suppress directive request only for a focused eligible item", () => {
    const current = snapshot();
    const item = current.home.learning[0];
    const answer = answerOperatorRepresentativeQuestion({
      question: "Don't use that.",
      snapshot: current,
      focusedItemId: item.id,
    });
    expect(answer.directiveRequest).toEqual({
      kind: "suppress",
      itemId: item.id,
    });
  });

  it("answers usage questions from durable lifecycle instead of configuration alone", () => {
    const current = snapshot();
    const item = current.home.learning[0];
    const answer = answerOperatorRepresentativeQuestion({
      question: "Are you using this?",
      snapshot: current,
      focusedItemId: item.id,
      adaptationLifecycle: [
        {
          directiveId: "11111111-1111-4111-8111-111111111111",
          targetItemId: item.id,
          targetKey: item.targetKey ?? null,
          directiveKind: "ask_instead",
          directiveStatus: "active",
          lifecycle: "used",
          behaviorClass: "ask_before_ambiguous_pending_continuation",
          useCount: 2,
          lastUsedAt: "2026-10-06T17:00:00.000Z",
        },
      ],
    });
    expect(answer.intent).toBe("using");
    expect(answer.reply).toMatch(/durable receipt proves Claire used this 2 times/i);
  });

  it("explains evidence without turning verification metadata into business truth", () => {
    const current = snapshot();
    const item = current.home.learning[0];
    const answer = answerOperatorRepresentativeQuestion({
      question: "Why do you think that?",
      snapshot: current,
      focusedItemId: item.id,
    });
    expect(answer.intent).toBe("why");
    expect(answer.itemRefs).toEqual([item.id]);
    expect(answer.evidenceRefs.length).toBeGreaterThan(0);
    expect(answer.reply).not.toMatch(/invoice (?:is|was) paid|customer replied|revenue increased/i);
  });

  it("does not claim a business result when asked an unsupported business-truth question", () => {
    const answer = answerOperatorRepresentativeQuestion({
      question: "Was the invoice paid?",
      snapshot: snapshot(),
    });
    expect(answer.reply).not.toMatch(/yes[, .]|it was paid|invoice was paid/i);
    expect(answer.reply).toMatch(/explain what you explicitly told me/i);
  });
});
