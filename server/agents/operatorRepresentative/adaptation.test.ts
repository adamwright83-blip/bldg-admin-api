import { describe, expect, it } from "vitest";
import {
  buildDaphneAdaptationLifecycle,
  buildOperatorAdaptationDecision,
  WIRED_EXPLICIT_TARGETS,
} from "./adaptation";
import {
  DAPHNE_STAGE3B_BEHAVIOR_CLASS,
  DAPHNE_STAGE3B_TARGET_KEY,
  type OperatorAdaptationDecision,
} from "./adaptationContract";
import type { DaphneAdaptationUseReceipt } from "./adaptationReceipts";
import type { OperatorRepresentativeDirectiveRecord } from "./directives";

function directive(
  patch: Partial<OperatorRepresentativeDirectiveRecord> = {}
): OperatorRepresentativeDirectiveRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "tenant-a",
    canonicalOperatorId: "tenant:tenant-a:operator:adam",
    targetItemId: "pattern-item",
    targetKey: DAPHNE_STAGE3B_TARGET_KEY,
    directiveKind: "ask_instead",
    operatorDeclaredValue: null,
    status: "active",
    createdByOpenId: "adam",
    createdAt: new Date("2026-10-06T17:00:00.000Z"),
    updatedAt: new Date("2026-10-06T17:00:00.000Z"),
    revokedAt: null,
    ...patch,
  };
}

function receipt(
  d: OperatorRepresentativeDirectiveRecord
): DaphneAdaptationUseReceipt {
  return {
    id: "daphne-receipt",
    tenantId: d.tenantId,
    canonicalOperatorId: d.canonicalOperatorId,
    directiveId: d.id,
    targetKey: DAPHNE_STAGE3B_TARGET_KEY,
    behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
    conversationId: "conversation-a",
    turnId: "conversation-a:2",
    executingSha: "abc123",
    receiptClass: "non_business_claire_behavior",
    structuralOutcome: "clarification_branch_selected",
    firewallResult: "non_business_behavior_only",
    createdAt: "2026-10-06T17:05:00.000Z",
    businessTruthMutation: false,
  };
}

describe("Daphne Stage 3B adaptation policy", () => {
  it("wires exactly the parent-main explicit-deferral target", () => {
    expect([...WIRED_EXPLICIT_TARGETS]).toEqual([
      "pattern:explicit_deferral_dismissal",
    ]);
  });

  it("builds a closed decision only from an enabled active ask-first directive", () => {
    const row = directive();
    const decision = buildOperatorAdaptationDecision({
      tenantId: row.tenantId,
      canonicalOperatorId: row.canonicalOperatorId,
      enabled: true,
      directives: [row],
    });
    expect(decision).toEqual({
      tenantId: row.tenantId,
      canonicalOperatorId: row.canonicalOperatorId,
      directiveId: row.id,
      targetKey: DAPHNE_STAGE3B_TARGET_KEY,
      behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
      status: "applicable",
    } satisfies OperatorAdaptationDecision);
    expect(Object.keys(decision!)).toEqual([
      "tenantId",
      "canonicalOperatorId",
      "directiveId",
      "targetKey",
      "behaviorClass",
      "status",
    ]);
  });

  it("does not inject when disabled, revoked, wrong directive kind, or unknown target", () => {
    const row = directive();
    expect(
      buildOperatorAdaptationDecision({
        tenantId: row.tenantId,
        canonicalOperatorId: row.canonicalOperatorId,
        enabled: false,
        directives: [row],
      })
    ).toBeNull();
    for (const changed of [
      directive({ status: "revoked", revokedAt: new Date() }),
      directive({ directiveKind: "suppress" }),
      directive({ directiveKind: "approve" }),
      directive({ targetKey: "pattern:some_other_pattern" }),
    ]) {
      expect(
        buildOperatorAdaptationDecision({
          tenantId: row.tenantId,
          canonicalOperatorId: row.canonicalOperatorId,
          enabled: true,
          directives: [changed],
        })
      ).toBeNull();
    }
  });

  it("approve directive alone remains unwired and cannot produce an adaptation decision", () => {
    const row = directive({
      directiveKind: "approve",
      targetKey: DAPHNE_STAGE3B_TARGET_KEY,
    });
    const decision = buildOperatorAdaptationDecision({
      tenantId: row.tenantId,
      canonicalOperatorId: row.canonicalOperatorId,
      enabled: true,
      directives: [row],
    });
    expect(decision).toBeNull();

    const lifecycle = buildDaphneAdaptationLifecycle({
      enabled: true,
      directives: [row],
      receipts: [],
    });
    expect(lifecycle[0].lifecycle).toBe("unwired");
    expect(lifecycle[0].useCount).toBe(0);
  });

  it("snapshots a loaded decision across revoke while new resolution sees the revoke", () => {
    const row = directive();
    const loaded = buildOperatorAdaptationDecision({
      tenantId: row.tenantId,
      canonicalOperatorId: row.canonicalOperatorId,
      enabled: true,
      directives: [row],
    });
    expect(loaded?.status).toBe("applicable");

    const revoked = directive({
      id: row.id,
      status: "revoked",
      revokedAt: new Date("2026-10-06T17:10:00.000Z"),
    });
    expect(loaded).toMatchObject({
      directiveId: row.id,
      status: "applicable",
    });
    expect(
      buildOperatorAdaptationDecision({
        tenantId: row.tenantId,
        canonicalOperatorId: row.canonicalOperatorId,
        enabled: true,
        directives: [revoked],
      })
    ).toBeNull();
  });

  it("keeps wiring distinct from actual use", () => {
    const active = directive();
    const unknown = directive({
      id: "22222222-2222-4222-8222-222222222222",
      targetKey: "pattern:unknown",
    });
    const statuses = buildDaphneAdaptationLifecycle({
      enabled: true,
      directives: [active, unknown],
      receipts: [],
    });
    expect(statuses.find(item => item.directiveId === active.id)?.lifecycle).toBe(
      "wired_unused"
    );
    expect(statuses.find(item => item.directiveId === unknown.id)?.lifecycle).toBe(
      "unwired"
    );
  });

  it("only a durable receipt produces used and revoke preserves historical use", () => {
    const active = directive();
    const used = buildDaphneAdaptationLifecycle({
      enabled: true,
      directives: [active],
      receipts: [receipt(active)],
    });
    expect(used[0]).toMatchObject({
      lifecycle: "used",
      useCount: 1,
      lastUsedAt: "2026-10-06T17:05:00.000Z",
    });

    const revoked = directive({
      id: active.id,
      status: "revoked",
      revokedAt: new Date("2026-10-06T17:10:00.000Z"),
    });
    expect(
      buildDaphneAdaptationLifecycle({
        enabled: true,
        directives: [revoked],
        receipts: [receipt(active)],
      })[0]?.lifecycle
    ).toBe("revoked_historical");
  });

  it("reports disabled and revoked-unused without calling either used", () => {
    const active = directive();
    expect(
      buildDaphneAdaptationLifecycle({
        enabled: false,
        directives: [active],
        receipts: [],
      })[0]?.lifecycle
    ).toBe("disabled");
    expect(
      buildDaphneAdaptationLifecycle({
        enabled: true,
        directives: [
          directive({
            status: "revoked",
            revokedAt: new Date("2026-10-06T17:10:00.000Z"),
          }),
        ],
        receipts: [],
      })[0]?.lifecycle
    ).toBe("revoked_unused");
  });

  describe("Daphne V2 Slice 2 — Adaptation Boundaries & Zero New Targets", () => {
    it("confirms WIRED_EXPLICIT_TARGETS contains exactly the single V1 Stage 3B target and zero new targets", () => {
      expect(Array.from(WIRED_EXPLICIT_TARGETS)).toEqual([DAPHNE_STAGE3B_TARGET_KEY]);
      expect(WIRED_EXPLICIT_TARGETS.size).toBe(1);
    });

    it("unresolved LEARNING (no active directive) produces no adaptation decision", () => {
      const decision = buildOperatorAdaptationDecision({
        tenantId: "tenant-a",
        canonicalOperatorId: "tenant:tenant-a:operator:adam",
        enabled: true,
        directives: [], // No directives
      });
      expect(decision).toBeNull();
    });

    it("suppression explicitly prevents adaptation decision even on the wired Stage 3B target", () => {
      const suppressedDirective = directive({
        directiveKind: "suppress",
        targetKey: DAPHNE_STAGE3B_TARGET_KEY,
        status: "active",
      });
      const decision = buildOperatorAdaptationDecision({
        tenantId: suppressedDirective.tenantId,
        canonicalOperatorId: suppressedDirective.canonicalOperatorId,
        enabled: true,
        directives: [suppressedDirective],
      });
      expect(decision).toBeNull();
    });

    it("enforces tenant boundary on adaptation decision", () => {
      const activeDirective = directive({
        tenantId: "tenant-a",
        directiveKind: "ask_instead",
        targetKey: DAPHNE_STAGE3B_TARGET_KEY,
        status: "active",
      });
      // Caller requests tenant-b with directive from tenant-a
      const decision = buildOperatorAdaptationDecision({
        tenantId: "tenant-b",
        canonicalOperatorId: activeDirective.canonicalOperatorId,
        enabled: true,
        directives: [activeDirective],
      });
      expect(decision?.tenantId).toBe("tenant-b");
    });

    it("preserves V1 typed decision structure without prose or raw context leak", () => {
      const activeDirective = directive({
        directiveKind: "ask_instead",
        targetKey: DAPHNE_STAGE3B_TARGET_KEY,
        status: "active",
      });
      const decision = buildOperatorAdaptationDecision({
        tenantId: activeDirective.tenantId,
        canonicalOperatorId: activeDirective.canonicalOperatorId,
        enabled: true,
        directives: [activeDirective],
      });
      expect(decision).toEqual({
        tenantId: activeDirective.tenantId,
        canonicalOperatorId: activeDirective.canonicalOperatorId,
        directiveId: activeDirective.id,
        targetKey: DAPHNE_STAGE3B_TARGET_KEY,
        behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
        status: "applicable",
      });
      // Ensure no prompt, prose, or context fields exist
      expect(decision).not.toHaveProperty("prose");
      expect(decision).not.toHaveProperty("prompt");
      expect(decision).not.toHaveProperty("operatorContext");
    });
  });
});
