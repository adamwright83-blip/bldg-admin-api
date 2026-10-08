import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperatorContextPacket } from "../agents/persistentOperator/operatorContext";
import {
  isClaireOperatorContextAdaptationEnabled,
  isClaireOperatorContextShadowEnabled,
  runClaireOperatorContextShadow,
  toClaireOperatorAdaptationContext,
  type ClaireOperatorContextShadowTelemetryEvent,
} from "./operatorAdaptationContext";
import { runClaireTurn } from "./turn/claireTurn";

function packet(): OperatorContextPacket {
  return {
    tenantId: "tenant-a",
    canonicalOperatorId: "tenant:tenant-a:operator:op",
    generatedAt: "2026-10-04T18:00:00.000Z",
    mappedUserIds: ["1"],
    card: {
      explicitFacts: [],
      explicitPreferences: [
        {
          kind: "working_hours",
          targetKey: "working_hours",
          preference: "after 10 AM",
          sourceSystem: "operator_profile",
          provenance: "operator_declared",
          evidenceRefId: "pref-1",
        },
      ],
    },
    observedPatterns: [],
    learnedSignals: [
      {
        learningKind: "time_preference",
        targetKey: "opaque-time-arm",
        confidence: "medium",
        deltaType: "boost",
        beforeState: { secret: "never expose" },
        afterState: { weight: 2 },
        evidenceReference: "outcome-1",
        sourceDeltaId: "delta-1",
        createdAt: "2026-10-04T17:00:00.000Z",
        evidenceRefId: "delta-ref",
      },
    ],
    interventionEvidence: [],
    uncertainty: [
      {
        reason: "evidence_window_truncated",
        scope: "ledger",
        detail: "Window truncated",
      },
    ],
    evidenceRefs: [
      {
        id: "pref-1",
        sourceSystem: "operator_profile",
        sourceRecordId: "pref-1",
        tenantId: "tenant-a",
        operatorUserId: "1",
        canonicalOperatorId: "tenant:tenant-a:operator:op",
        timestamp: "2026-10-04T18:00:00.000Z",
      },
      {
        id: "delta-ref",
        sourceSystem: "goal_cycle_learned_deltas",
        sourceRecordId: "delta-1",
        tenantId: "tenant-a",
        operatorUserId: "1",
        canonicalOperatorId: "tenant:tenant-a:operator:op",
        timestamp: "2026-10-04T17:00:00.000Z",
      },
    ],
  };
}

const oldShadow = process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED;
const oldLive = process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED;

afterEach(() => {
  if (oldShadow === undefined) delete process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED;
  else process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = oldShadow;
  if (oldLive === undefined) delete process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED;
  else process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED = oldLive;
});

describe("Claire Operator Context Stage 3A", () => {
  it("projects only bounded adaptation fields", () => {
    const result = toClaireOperatorAdaptationContext(packet());
    expect(result.explicitPreferences).toHaveLength(1);
    expect(result.learnedSignals).toEqual([
      {
        learningKind: "time_preference",
        targetKey: "opaque-time-arm",
        confidence: "medium",
        deltaType: "boost",
        sourceDeltaId: "delta-1",
        evidenceReference: "outcome-1",
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("never expose");
    expect(serialized).not.toContain("beforeState");
    expect(serialized).not.toContain("afterState");
    expect(serialized).not.toContain("interventionEvidence");
    expect(serialized).not.toContain("current_business_truth");
  });

  it("defaults both feature flags off and supports tenant allowlists", () => {
    delete process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED;
    delete process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED;
    expect(isClaireOperatorContextShadowEnabled("tenant-a")).toBe(false);
    expect(isClaireOperatorContextAdaptationEnabled("tenant-a")).toBe(false);

    process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = "tenant-a,tenant-b";
    process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED = "tenant-b";
    expect(isClaireOperatorContextShadowEnabled("tenant-a")).toBe(true);
    expect(isClaireOperatorContextShadowEnabled("tenant-c")).toBe(false);
    expect(isClaireOperatorContextAdaptationEnabled("tenant-a")).toBe(false);
    expect(isClaireOperatorContextAdaptationEnabled("tenant-b")).toBe(true);
  });

  it("never emits raw exception text into structural telemetry", async () => {
    const events: ClaireOperatorContextShadowTelemetryEvent[] = [];
    await runClaireOperatorContextShadow({
      tenantId: "tenant-a",
      operatorUserId: "op",
      deps: {
        loadOperatorAdaptationContext: async () => {
          throw new Error("SECRET_customer_phone_5551212");
        },
        onTelemetry: event => events.push(event),
        nowMs: (() => {
          let n = 100;
          return () => (n += 10);
        })(),
      },
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("SECRET_customer_phone_5551212");
    expect(events.at(-1)).toMatchObject({
      event: "operator_context_shadow_failed",
      failureReason: "adaptation_context_load_failed",
    });
  });

  it("captures Claire business time before awaited shadow latency", async () => {
    let nowCalls = 0;
    let doctrineToday: string | null = null;
    const result = await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "op",
        dayDirectorActorId: "1",
        utterance: "good morning",
        surface: "voice",
        state: {},
        conversationKey: "stage3a-clock",
      },
      {
        now: () => {
          nowCalls += 1;
          return nowCalls === 1
            ? new Date("2026-10-04T23:59:59.900-07:00")
            : new Date("2026-10-05T00:00:05.000-07:00");
        },
        timeZone: () => "America/Los_Angeles",
        doctrineTurn: async input => {
          doctrineToday = input.today;
          return "Morning.";
        },
        operatorContextShadowEnabled: () => true,
        loadOperatorAdaptationContext: async () => {
          await new Promise(resolve => setTimeout(resolve, 2));
          return toClaireOperatorAdaptationContext(packet());
        },
        onOperatorContextShadowTelemetry: vi.fn(),
      }
    );
    expect(nowCalls).toBe(1);
    expect(doctrineToday).toBe("2026-10-04");
    expect(result.speak).toBeTruthy();
  });

  it("shadow failure does not fail the Claire turn", async () => {
    const result = await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "op",
        dayDirectorActorId: "1",
        utterance: "good morning",
        surface: "voice",
        state: {},
        conversationKey: "stage3a-failure",
      },
      {
        now: () => new Date("2026-10-04T15:00:00.000-07:00"),
        timeZone: () => "America/Los_Angeles",
        doctrineTurn: async () => "Morning.",
        operatorContextShadowEnabled: () => true,
        loadOperatorAdaptationContext: async () => {
          throw new Error("database private detail");
        },
        onOperatorContextShadowTelemetry: vi.fn(),
      }
    );
    expect(result.speak).toBeTruthy();
  });
});
