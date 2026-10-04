import { describe, expect, it } from "vitest";
import type { CanonicalOperatorIdentity } from "../persistentOperator/identity";
import type { OperatorContextPacket } from "../persistentOperator/operatorContext";
import { buildOperatorRepresentativeSnapshot } from "./readModel";
import type { OperatorRepresentativeDirectiveRecord } from "./directives";

const identity: CanonicalOperatorIdentity = {
  tenantId: "tenant-a",
  canonicalOperatorId: "tenant:tenant-a:operator:adam",
  canonicalOpenId: "adam",
  canonicalUserId: 1,
  sourceOpenId: "adam",
  sourceUserId: 1,
  sourceRole: "admin",
  dayDirectorActorId: "1",
  dayDirectorActorIds: ["1"],
  weeklyOperatorId: "adam",
  campaignOperatorUserId: "adam",
  communicationOperatorUserId: "adam",
  membership: { source: "owner", canonical: "owner" },
  aliases: [],
};

function packet(): OperatorContextPacket {
  return {
    tenantId: "tenant-a",
    canonicalOperatorId: identity.canonicalOperatorId,
    generatedAt: "2026-10-04T18:00:00.000Z",
    mappedUserIds: ["1"],
    card: {
      explicitFacts: [
        {
          kind: "declared_service_area",
          statement: 'Declared service area: "Los Feliz and Silver Lake"',
          sourceSystem: "goldline_onboarding",
          provenance: "operator_declared",
          field: "service_area",
          observedAt: "2026-10-01T18:00:00.000Z",
          evidenceRefId: "ref-onboarding",
        },
      ],
      explicitPreferences: [],
    },
    observedPatterns: [
      {
        kind: "action_completion_rate",
        observationCount: 4,
        distinctDecisionPointCount: 4,
        distinctCorrelationCount: 4,
        summary: "4 completed actions observed across 4 qualifying decision points.",
        confidence: "descriptive",
        metrics: { completedCount: 4 },
        evidenceRefs: ["ref-ledger"],
      },
    ],
    learnedSignals: [
      {
        learningKind: "loadout_recommendation",
        targetKey: "sales_stop",
        confidence: "medium",
        deltaType: "boost",
        beforeState: null,
        afterState: { weight: 2 },
        evidenceReference: "outcome:1",
        sourceDeltaId: "delta-1",
        createdAt: "2026-10-03T18:00:00.000Z",
        evidenceRefId: "ref-delta",
      },
    ],
    interventionEvidence: [],
    uncertainty: [
      {
        reason: "insufficient_observations",
        scope: "working_time",
        detail: "Not enough observations.",
      },
    ],
    evidenceRefs: [
      {
        id: "ref-onboarding",
        sourceSystem: "goldline_onboarding_sessions",
        sourceRecordId: "session-1",
        tenantId: "tenant-a",
        operatorUserId: "1",
        canonicalOperatorId: identity.canonicalOperatorId,
        timestamp: "2026-10-01T18:00:00.000Z",
      },
      {
        id: "ref-ledger",
        sourceSystem: "behavioral_ledger",
        sourceRecordId: "100",
        tenantId: "tenant-a",
        operatorUserId: "1",
        canonicalOperatorId: identity.canonicalOperatorId,
        timestamp: "2026-10-02T18:00:00.000Z",
        verificationClass: "VERIFIED",
      },
      {
        id: "ref-delta",
        sourceSystem: "goal_cycle_learned_deltas",
        sourceRecordId: "delta-1",
        tenantId: "tenant-a",
        operatorUserId: "1",
        canonicalOperatorId: identity.canonicalOperatorId,
        timestamp: "2026-10-03T18:00:00.000Z",
        evidenceReference: "outcome:1",
      },
    ],
  };
}

function directive(
  patch: Partial<OperatorRepresentativeDirectiveRecord> = {}
): OperatorRepresentativeDirectiveRecord {
  return {
    id: "directive-1",
    tenantId: "tenant-a",
    canonicalOperatorId: identity.canonicalOperatorId,
    targetItemId: "unused",
    targetKey: null,
    directiveKind: "suppress",
    operatorDeclaredValue: null,
    status: "active",
    createdByOpenId: "adam",
    createdAt: new Date("2026-10-04T18:00:00.000Z"),
    updatedAt: new Date("2026-10-04T18:00:00.000Z"),
    revokedAt: null,
    ...patch,
  };
}

describe("Operator Representative grounded read model", () => {
  it("classifies explicit, descriptive, uncertain, and learned sources without inventing cards", () => {
    const snapshot = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [],
    });

    expect(snapshot.home.known).toHaveLength(1);
    expect(snapshot.home.known[0].provenanceClass).toBe("operator_declared");

    expect(snapshot.home.learning).toHaveLength(1);
    expect(snapshot.home.learning[0]).toMatchObject({
      provenanceClass: "descriptive_observation",
      confidence: "descriptive",
      canAffectAdaptation: false,
    });

    expect(snapshot.home.uncertain).toHaveLength(1);
    expect(snapshot.home.uncertain[0]).toMatchObject({
      uncertaintyReason: "insufficient_observations",
      title: "Not enough evidence yet",
    });

    expect(snapshot.home.changed).toHaveLength(1);
    expect(snapshot.home.changed[0]).toMatchObject({
      provenanceClass: "learned_delta",
      learningKind: "loadout_recommendation",
      adaptationState: "eligible_not_wired",
      canAffectAdaptation: false,
    });
  });

  it("keeps business-truth authority false even for a VERIFIED-class source row", () => {
    const snapshot = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [],
    });
    const learning = snapshot.home.learning[0];
    const detail = snapshot.details.get(learning.id);

    expect(detail?.businessTruthSupport).toBe(false);
    expect(detail?.evidence[0]).toMatchObject({
      verificationClass: "VERIFIED",
      businessTruthSupport: false,
    });
    expect(detail?.forbiddenUse).toMatch(/cannot use this item to prove revenue/i);
  });

  it("uses stable deterministic item IDs", () => {
    const first = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [],
    });
    const second = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [],
    });
    expect(second.home.known[0].id).toBe(first.home.known[0].id);
    expect(second.home.learning[0].id).toBe(first.home.learning[0].id);
    expect(second.home.changed[0].id).toBe(first.home.changed[0].id);
  });

  it("applies an explicit correction to the target value while preserving source evidence", () => {
    const base = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [],
    });
    const target = base.home.known[0];

    const corrected = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [
        directive({
          id: "correction-1",
          targetItemId: target.id,
          targetKey: target.targetKey ?? null,
          directiveKind: "correction",
          operatorDeclaredValue: { value: "East Hollywood only" },
        }),
      ],
    });

    const item = corrected.home.known.find(candidate => candidate.id === target.id);
    const detail = corrected.details.get(target.id);
    expect(item).toMatchObject({
      summary: "East Hollywood only",
      provenanceClass: "operator_directive",
      confidence: "declared",
    });
    expect(detail?.provenance).toBe("Explicit correction declared by you");
    expect(detail?.evidence[0]?.sourceSystem).toBe("goldline_onboarding_sessions");
  });

  it("a suppress directive makes the signal ineligible without deleting it", () => {
    const base = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [],
    });
    const target = base.home.learning[0];

    const suppressed = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [
        directive({
          id: "suppress-1",
          targetItemId: target.id,
          targetKey: target.targetKey ?? null,
          directiveKind: "suppress",
        }),
      ],
    });

    const item = suppressed.home.learning.find(candidate => candidate.id === target.id);
    expect(item).toMatchObject({
      adaptationState: "suppressed",
      canAffectAdaptation: false,
      activeDirectiveId: "suppress-1",
    });
    expect(suppressed.details.get(target.id)).toBeDefined();
  });

  it("rejects packet/identity tenant mismatches", () => {
    const mismatched = packet();
    mismatched.tenantId = "tenant-b";
    expect(() =>
      buildOperatorRepresentativeSnapshot({
        identity,
        packet: mismatched,
        directives: [],
      })
    ).toThrow(/tenant mismatch/i);
  });
});
