import { describe, expect, it } from "vitest";
import type { CanonicalOperatorIdentity } from "../persistentOperator/identity";
import type { OperatorContextPacket } from "../persistentOperator/operatorContext";
import { buildOperatorRepresentativeSnapshot } from "./readModel";
import {
  loadOperatorRepresentativeDirectiveSnapshot,
  type OperatorRepresentativeDirectiveRecord,
} from "./directives";

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
        scopeKey: "all_qualifying_actions",
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

  it("keeps ask-first directives unwired for non-Stage-3B pattern targets", () => {
    const base = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [],
    });
    const target = base.home.learning[0];

    const askFirst = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [
        directive({
          id: "ask-first-unwired",
          targetItemId: target.id,
          targetKey: target.targetKey ?? null,
          directiveKind: "ask_instead",
        }),
      ],
    });

    const item = askFirst.home.learning.find(candidate => candidate.id === target.id);
    expect(item).toMatchObject({
      adaptationState: "ask_instead",
      canAffectAdaptation: false,
      activeDirectiveId: "ask-first-unwired",
    });
    expect(askFirst.details.get(target.id)?.allowedUse).toMatch(
      /does not automatically steer Claire/i
    );
  });

  it("allows an explicit ask-first directive to affect only the wired Stage 3B target", () => {
    const wiredPacket = packet();
    wiredPacket.observedPatterns[0] = {
      ...wiredPacket.observedPatterns[0],
      kind: "explicit_deferral_dismissal",
      scopeKey: "all_explicit_deferrals_dismissals",
      summary:
        "Observed 3 explicit DEFERRED event(s) and 0 explicit DISMISSED event(s) across distinct decision points.",
      metrics: { deferredCount: 3, dismissedCount: 0 },
    };
    const base = buildOperatorRepresentativeSnapshot({
      identity,
      packet: wiredPacket,
      directives: [],
    });
    const target = base.home.learning[0];
    expect(target.targetKey).toBe("pattern:explicit_deferral_dismissal");
    expect(target.canAffectAdaptation).toBe(false);

    const askFirst = buildOperatorRepresentativeSnapshot({
      identity,
      packet: wiredPacket,
      directives: [
        directive({
          id: "ask-first-wired",
          targetItemId: target.id,
          targetKey: target.targetKey ?? null,
          directiveKind: "ask_instead",
        }),
      ],
    });

    const item = askFirst.home.learning.find(candidate => candidate.id === target.id);
    expect(item).toMatchObject({
      adaptationState: "ask_instead",
      canAffectAdaptation: true,
      activeDirectiveId: "ask-first-wired",
    });
    expect(askFirst.details.get(target.id)?.businessTruthSupport).toBe(false);
    expect(askFirst.details.get(target.id)?.allowedUse).toMatch(
      /constrain how JOYSTICK works with you/i
    );
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

  it("keeps observed-pattern IDs stable across evidence churn so directives still apply", () => {
    const firstPacket = packet();
    const firstSnapshot = buildOperatorRepresentativeSnapshot({
      identity,
      packet: firstPacket,
      directives: [],
    });
    const originalItem = firstSnapshot.home.learning[0];

    const changedPacket = packet();
    changedPacket.observedPatterns[0] = {
      ...changedPacket.observedPatterns[0],
      observationCount: 5,
      distinctDecisionPointCount: 5,
      distinctCorrelationCount: 5,
      summary: "5 completed actions observed across 5 qualifying decision points.",
      metrics: { completedCount: 5 },
      evidenceRefs: ["ref-ledger-new", "ref-ledger"],
    };
    changedPacket.evidenceRefs.push({
      id: "ref-ledger-new",
      sourceSystem: "behavioral_ledger",
      sourceRecordId: "101",
      tenantId: "tenant-a",
      operatorUserId: "1",
      canonicalOperatorId: identity.canonicalOperatorId,
      timestamp: "2026-10-04T18:00:00.000Z",
      verificationClass: "VERIFIED",
    });

    const rebuilt = buildOperatorRepresentativeSnapshot({
      identity,
      packet: changedPacket,
      directives: [
        directive({
          id: "stable-pattern-suppress",
          targetItemId: originalItem.id,
          targetKey: originalItem.targetKey ?? null,
          directiveKind: "suppress",
        }),
      ],
    });

    const changedItem = rebuilt.home.learning[0];
    expect(changedItem.id).toBe(originalItem.id);
    expect(changedItem).toMatchObject({
      adaptationState: "suppressed",
      activeDirectiveId: "stable-pattern-suppress",
      canAffectAdaptation: false,
    });
  });

  it("uses semantic pattern scope to avoid collisions for the same pattern kind", () => {
    const scopedPacket = packet();
    const original = scopedPacket.observedPatterns[0];
    scopedPacket.observedPatterns = [
      { ...original, scopeKey: "sales_actions", evidenceRefs: ["ref-ledger"] },
      { ...original, scopeKey: "delivery_actions", evidenceRefs: ["ref-ledger"] },
    ];

    const snapshot = buildOperatorRepresentativeSnapshot({
      identity,
      packet: scopedPacket,
      directives: [],
    });

    expect(snapshot.home.learning).toHaveLength(2);
    expect(snapshot.home.learning[0].id).not.toBe(snapshot.home.learning[1].id);
  });

  it("keeps an older active directive outside the 100-row revoked history window", async () => {
    const base = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: [],
    });
    const target = base.home.learning[0];

    const olderActive = directive({
      id: "older-active-suppress",
      targetItemId: target.id,
      targetKey: target.targetKey ?? null,
      directiveKind: "suppress",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const newerRevoked = Array.from({ length: 101 }, (_, index) =>
      directive({
        id: `revoked-${index}`,
        targetItemId: `unrelated-${index}`,
        targetKey: `unrelated-${index}`,
        directiveKind: "ask_instead",
        status: "revoked",
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)),
        updatedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)),
        revokedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)),
      })
    ).reverse();

    let requestedHistoryLimit: number | undefined;
    const directiveSnapshot = await loadOperatorRepresentativeDirectiveSnapshot(
      {
        tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        recentHistoryLimit: 100,
      },
      {
        listActive: async () => [olderActive],
        listRecentRevoked: async input => {
          requestedHistoryLimit = input.limit;
          return newerRevoked.slice(0, input.limit ?? 100);
        },
      }
    );

    expect(requestedHistoryLimit).toBe(100);
    expect(directiveSnapshot.active).toEqual([olderActive]);
    expect(directiveSnapshot.recentHistory).toHaveLength(100);
    expect(directiveSnapshot.directives[0]).toEqual(olderActive);
    expect(directiveSnapshot.directives).toHaveLength(101);

    const rebuilt = buildOperatorRepresentativeSnapshot({
      identity,
      packet: packet(),
      directives: directiveSnapshot.directives,
    });
    const controlledItem = rebuilt.home.learning.find(item => item.id === target.id);
    expect(controlledItem).toMatchObject({
      adaptationState: "suppressed",
      activeDirectiveId: "older-active-suppress",
      canAffectAdaptation: false,
    });
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

  describe("Daphne V2 Consent Loop — Slice 1 invariants", () => {
    it("LEARNING item with no directive is pending review, cannot adapt on its own, and offers canApprove", () => {
      const snapshot = buildOperatorRepresentativeSnapshot({
        identity,
        packet: packet(),
        directives: [],
      });

      const item = snapshot.home.learning[0];
      expect(item).toBeDefined();
      expect(item.pendingReview).toBe(true);
      expect(item.adaptationState).toBe("not_eligible");
      expect(item.canAffectAdaptation).toBe(false);
      expect(item.activeDirectiveId).toBeUndefined();

      const detail = snapshot.details.get(item.id);
      expect(detail).toBeDefined();
      expect(detail?.canApprove).toBe(true);
      expect(detail?.canSuppress).toBe(true);
      expect(detail?.canAskInstead).toBe(true);
      expect(detail?.canCorrect).toBe(false);
    });

    it("attaches approval directive to existing stable targetItemId, clearing pendingReview while remaining unwired", () => {
      const base = buildOperatorRepresentativeSnapshot({
        identity,
        packet: packet(),
        directives: [],
      });
      const target = base.home.learning[0];

      const approveDirective = directive({
        id: "approve-directive-1",
        targetItemId: target.id,
        targetKey: target.targetKey ?? null,
        directiveKind: "approve",
        status: "active",
      });

      const snapshot = buildOperatorRepresentativeSnapshot({
        identity,
        packet: packet(),
        directives: [approveDirective],
      });

      const item = snapshot.home.learning.find(candidate => candidate.id === target.id);
      expect(item).toBeDefined();
      expect(item?.id).toBe(target.id); // Same stable item ID!
      expect(item?.pendingReview).toBe(false);
      expect(item?.activeDirectiveId).toBe(approveDirective.id);
      expect(item?.adaptationState).toBe("eligible_not_wired");
      expect(item?.canAffectAdaptation).toBe(false); // Unwired! Cannot adapt on its own.
    });

    it("preserves V1 Stage 3B ask_instead on explicit deferral dismissal without requiring approval", () => {
      const customPacket = packet();
      customPacket.observedPatterns = [
        {
          kind: "explicit_deferral_dismissal",
          scopeKey: "all_qualifying_actions",
          observationCount: 3,
          distinctDecisionPointCount: 3,
          distinctCorrelationCount: 3,
          summary: "Explicit deferral dismissal pattern observed.",
          confidence: "descriptive",
          evidenceRefs: ["ref-ledger"],
        },
      ];

      const base = buildOperatorRepresentativeSnapshot({
        identity,
        packet: customPacket,
        directives: [],
      });
      const target = base.home.learning[0];
      expect(target.targetKey).toBe("pattern:explicit_deferral_dismissal");

      // V1 ask_instead directive attached directly, without an 'approve' directive
      const askInsteadDirective = directive({
        id: "ask-instead-directive-1",
        targetItemId: target.id,
        targetKey: target.targetKey ?? null,
        directiveKind: "ask_instead",
        status: "active",
      });

      const snapshot = buildOperatorRepresentativeSnapshot({
        identity,
        packet: customPacket,
        directives: [askInsteadDirective],
      });

      const item = snapshot.home.learning.find(candidate => candidate.id === target.id);
      expect(item).toBeDefined();
      expect(item?.adaptationState).toBe("ask_instead");
      expect(item?.canAffectAdaptation).toBe(true); // V1 Stage 3B wired behavior intact!
      expect(item?.pendingReview).toBe(false);
    });

    it("evidence window changes do not detach approval, suppress, ask_instead, or revoke from stable item ID", () => {
      const packet1 = packet();
      const base = buildOperatorRepresentativeSnapshot({
        identity,
        packet: packet1,
        directives: [],
      });
      const originalItemId = base.home.learning[0].id;

      const approveDirective = directive({
        id: "stable-approve-directive",
        targetItemId: originalItemId,
        targetKey: base.home.learning[0].targetKey ?? null,
        directiveKind: "approve",
        status: "active",
      });

      // Packet 2: observationCount changes from 4 to 12, different timestamp
      const packet2 = packet();
      packet2.observedPatterns[0] = {
        ...packet2.observedPatterns[0],
        observationCount: 12,
        distinctDecisionPointCount: 12,
        distinctCorrelationCount: 12,
        summary: "12 completed actions observed across 12 qualifying decision points.",
      };

      const rebuilt = buildOperatorRepresentativeSnapshot({
        identity,
        packet: packet2,
        directives: [approveDirective],
      });

      const rebuiltItem = rebuilt.home.learning[0];
      expect(rebuiltItem.id).toBe(originalItemId); // Item ID stays identical
      expect(rebuiltItem.activeDirectiveId).toBe(approveDirective.id);
      expect(rebuiltItem.adaptationState).toBe("eligible_not_wired");
      expect(rebuiltItem.pendingReview).toBe(false);
    });
  });
});
