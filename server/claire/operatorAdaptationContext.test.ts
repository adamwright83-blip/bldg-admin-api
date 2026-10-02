import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isClaireOperatorContextShadowEnabled,
  assertNoForbiddenAdaptationPatterns,
  toClaireOperatorAdaptationContext,
  runClaireOperatorContextShadow,
  defaultEmitClaireOperatorContextShadowTelemetry,
  loadClaireOperatorAdaptationContext,
  type ClaireOperatorAdaptationContext,
  type ClaireOperatorContextShadowTelemetryEvent,
} from "./operatorAdaptationContext";
import type {
  OperatorContextPacket,
  OperatorExplicitPreference,
  OperatorLearnedSignal,
} from "../persistentOperator/operatorContext";
import { runClaireTurn } from "./turn/claireTurn";

function makeMinimalPacket(overrides: Partial<OperatorContextPacket> = {}): OperatorContextPacket {
  return {
    canonicalOperatorId: "canonical_op_1",
    tenantId: "tenant_alpha",
    generatedAt: "2026-10-02T01:00:00.000Z",
    mappedUserIds: [1, 2],
    card: {
      canonicalOperatorId: "canonical_op_1",
      tenantId: "tenant_alpha",
      explicitPreferences: [
        {
          key: "channel_affinity",
          value: "sms",
          provenance: "operator_declared",
          observedAt: "2026-10-01T12:00:00.000Z",
          sourceReference: "onboarding:1",
        },
        {
          key: "inferred_style",
          value: "brief",
          provenance: "system_default" as any,
          observedAt: "2026-10-01T12:00:00.000Z",
          sourceReference: "default",
        },
      ],
      currentRole: null,
      operatingContext: null,
      uncertainty: [],
    },
    learnedSignals: [
      {
        learningKind: "time_preference",
        targetKey: "time:early_morning",
        confidence: "medium",
        deltaType: "boost",
        sourceDeltaId: "delta_101",
        evidenceReference: "goal_cycle:42",
      },
    ],
    interventionEvidence: [],
    observedPatterns: [],
    evidenceRefs: ["ledger:1", "ledger:2"],
    uncertainty: [
      {
        reason: "no_records",
        detail: "No behavioral ledger records found for operator.",
        remediation: "Continue observing operator interactions.",
      },
    ],
    ...overrides,
  };
}

describe("Stage 3A: Claire Operator Adaptation Context", () => {
  const originalEnv = process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED;

  beforeEach(() => {
    delete process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = originalEnv;
    } else {
      delete process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED;
    }
  });

  // -------------------------------------------------------------------------
  // 1. Projection & Filtering
  // -------------------------------------------------------------------------
  describe("Projection & Filtering", () => {
    it("preserves ONLY operator_declared explicit preferences and excludes system_default / inferred", () => {
      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);

      expect(adaptation.explicitPreferences).toHaveLength(1);
      expect(adaptation.explicitPreferences[0].key).toBe("channel_affinity");
      expect(adaptation.explicitPreferences[0].provenance).toBe("operator_declared");
    });

    it("projects learned signals into structured audit metadata without explanatory prose", () => {
      const signalWithExtra = {
        learningKind: "channel_affinity" as const,
        targetKey: "voice",
        confidence: "high" as const,
        deltaType: "reinforce" as const,
        sourceDeltaId: "delta_999",
        evidenceReference: "goal_cycle:99",
        explanation: "Operator tends to favor phone calls because of busy mornings",
      };

      const packet = makeMinimalPacket({
        learnedSignals: [signalWithExtra as unknown as OperatorLearnedSignal],
      });

      const adaptation = toClaireOperatorAdaptationContext(packet);
      expect(adaptation.learnedSignals).toHaveLength(1);
      const projected = adaptation.learnedSignals[0];
      expect(projected.learningKind).toBe("channel_affinity");
      expect(projected.targetKey).toBe("voice");
      expect(projected.confidence).toBe("high");
      expect(projected.deltaType).toBe("reinforce");
      expect(projected.sourceDeltaId).toBe("delta_999");
      expect(projected.evidenceReference).toBe("goal_cycle:99");

      // Verify no explanation or prose leaked onto the signal
      expect((projected as any).explanation).toBeUndefined();
    });

    it("preserves distinct uncertainty reasons and evidenceWindowTruncated flag", () => {
      const packet = makeMinimalPacket({
        uncertainty: [
          {
            reason: "evidence_window_truncated",
            detail: "Query limit reached",
            remediation: "Narrow window",
          },
          {
            reason: "no_records",
            detail: "No records",
            remediation: "Wait",
          },
        ],
      });

      const adaptation = toClaireOperatorAdaptationContext(packet);
      expect(adaptation.uncertaintyReasons).toContain("evidence_window_truncated");
      expect(adaptation.uncertaintyReasons).toContain("no_records");
      expect(adaptation.evidenceWindowTruncated).toBe(true);
      expect(adaptation.metadata.evidenceWindowTruncated).toBe(true);
      expect(adaptation.metadata.uncertaintyCount).toBe(2);
    });

    it("calculates structural metadata correctly", () => {
      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);

      expect(adaptation.metadata).toEqual({
        generatedAt: packet.generatedAt,
        mappedUserCount: 2,
        evidenceRefCount: 2,
        explicitPreferenceCount: 1,
        learnedSignalCount: 1,
        uncertaintyCount: 1,
        evidenceWindowTruncated: false,
      });
    });

    it("excludes raw ledger rows, conversation history, and free-text answers from projection", () => {
      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);

      expect((adaptation as any).interventionEvidence).toBeUndefined();
      expect((adaptation as any).observedPatterns).toBeUndefined();
      expect((adaptation as any).evidenceRefs).toBeUndefined();
      expect((adaptation as any).history).toBeUndefined();
      expect((adaptation as any).rawLedgerRows).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Channel Rule
  // -------------------------------------------------------------------------
  describe("Channel Rule", () => {
    it("treats channel affinity as an opaque targetKey without generating transport recommendations", () => {
      const packet = makeMinimalPacket({
        learnedSignals: [
          {
            learningKind: "channel_affinity",
            targetKey: "voice",
            confidence: "high",
            deltaType: "boost",
            sourceDeltaId: "delta_c1",
            evidenceReference: "ref_c1",
          },
        ],
      });

      const adaptation = toClaireOperatorAdaptationContext(packet);
      const signal = adaptation.learnedSignals[0];
      expect(signal.learningKind).toBe("channel_affinity");
      expect(signal.targetKey).toBe("voice");

      // Invariant: channel_affinity is opaque, never converted into a transport directive
      expect((adaptation as any).transportRecommendation).toBeUndefined();
      expect((adaptation as any).recommendedChannel).toBeUndefined();
      expect((adaptation as any).channelDirective).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Psychology & Diagnosis Firewall
  // -------------------------------------------------------------------------
  describe("Psychology & Diagnosis Firewall", () => {
    it("passes assertion for clean, non-diagnostic adaptation context", () => {
      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);
      expect(() => assertNoForbiddenAdaptationPatterns(adaptation)).not.toThrow();
    });

    it("throws error if forbidden diagnostic pattern appears in explicit preferences", () => {
      const forbiddenPref: OperatorExplicitPreference = {
        key: "work_style",
        value: "operator is avoidant and lazy",
        provenance: "operator_declared",
        observedAt: "2026-10-01T12:00:00.000Z",
        sourceReference: "ref",
      };

      const packet = makeMinimalPacket({
        card: {
          canonicalOperatorId: "canonical_op_1",
          tenantId: "tenant_alpha",
          explicitPreferences: [forbiddenPref],
          currentRole: null,
          operatingContext: null,
          uncertainty: [],
        },
      });

      expect(() => toClaireOperatorAdaptationContext(packet)).toThrow(
        /forbidden diagnostic or causal phrasing/
      );
    });

    it("throws error if forbidden diagnostic pattern appears in learned signal targetKey", () => {
      const packet = makeMinimalPacket({
        learnedSignals: [
          {
            learningKind: "time_preference",
            targetKey: "operator is neurodivergent and exhibits adhd traits",
            confidence: "high",
            deltaType: "boost",
            sourceDeltaId: "delta_1",
            evidenceReference: "ref_1",
          },
        ],
      });

      expect(() => toClaireOperatorAdaptationContext(packet)).toThrow(
        /forbidden diagnostic or causal phrasing/
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. Permanent Business Truth Firewall & Architectural Boundaries
  // -------------------------------------------------------------------------
  describe("Permanent Business Truth Firewall & Architectural Boundaries", () => {
    it("never grants authoritativeFor current_business_truth on ClaireOperatorAdaptationContext", () => {
      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);

      expect((adaptation as any).authoritativeFor).toBeUndefined();
      expect((adaptation as any).current_business_truth).toBeUndefined();
      expect(JSON.stringify(adaptation)).not.toContain('"authoritativeFor"');
    });

    it("cannot authorize commercial claims like invoice paid, called Dana, customer replied, or revenue increased", () => {
      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);

      // Adaptation context must have no commercial receipts or fact assertion properties
      expect((adaptation as any).receipts).toBeUndefined();
      expect((adaptation as any).factualClaims).toBeUndefined();
      expect((adaptation as any).verifiedFacts).toBeUndefined();
      expect((adaptation as any).commercialOutcomes).toBeUndefined();
    });

    it("verifies server/claire/turn/brainV3.ts does NOT import operatorAdaptationContext or operatorContext", () => {
      const brainV3Path = resolve(__dirname, "./turn/brainV3.ts");
      const content = readFileSync(brainV3Path, "utf-8");
      expect(content).not.toContain("operatorAdaptationContext");
      expect(content).not.toContain("OperatorAdaptationContext");
      expect(content).not.toContain("operatorContext");
      expect(content).not.toContain("OperatorContextPacket");
    });

    it("verifies server/claire/turn/claireTurn.ts isolates shadow context from prompts, LLMs, and Brain V3", () => {
      const turnPath = resolve(__dirname, "./turn/claireTurn.ts");
      const content = readFileSync(turnPath, "utf-8");

      // Shadow execution is called
      expect(content).toContain("runClaireOperatorContextShadow");

      // Invariant: The result of shadow execution is NEVER passed to any downstream prompts, LLM invocations, or Brain V3
      expect(content).not.toMatch(/interpretClaireBrainV3\([^)]*shadow/);
      expect(content).not.toMatch(/answerClaireBusinessTurn\([^)]*shadow/);
      expect(content).not.toMatch(/extractBriefingWithModel\([^)]*shadow/);
      expect(content).not.toMatch(/buildClaireVerifiedFactInventory\([^)]*shadow/);
      expect(content).not.toMatch(/assembleGuardedClaireSpeak\([^)]*shadow/);
    });

    it("verifies server/persistentOperator/decisionEngine.ts was NOT edited", () => {
      const dePath = resolve(__dirname, "../persistentOperator/decisionEngine.ts");
      const content = readFileSync(dePath, "utf-8");
      expect(content).not.toContain("ClaireOperatorAdaptationContext");
      expect(content).not.toContain("claire_shadow");
    });

    it("verifies server/behavioralSelection/selectPreferredFiction.ts was NOT edited", () => {
      const pfPath = resolve(__dirname, "../behavioralSelection/selectPreferredFiction.ts");
      const content = readFileSync(pfPath, "utf-8");
      expect(content).not.toContain("ClaireOperatorAdaptationContext");
      expect(content).not.toContain("claire_shadow");
    });

    it("verifies drizzle/schema.ts contains no operator representation, beliefs, or conclusions tables", () => {
      const schemaPath = resolve(__dirname, "../../drizzle/schema.ts");
      const content = readFileSync(schemaPath, "utf-8");
      expect(content).not.toContain("operator_context");
      expect(content).not.toContain("operator_beliefs");
      expect(content).not.toContain("operator_conclusions");
      expect(content).not.toContain("operator_representation");
    });

    it("verifies server/claire/operatorAdaptationContext.ts has no imports from server/mitch/", () => {
      const adapterPath = resolve(__dirname, "./operatorAdaptationContext.ts");
      const content = readFileSync(adapterPath, "utf-8");
      expect(content).not.toContain("server/mitch");
      expect(content).not.toContain("../mitch");
      expect(content).not.toContain("/mitch/");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Identity & Tenant Isolation
  // -------------------------------------------------------------------------
  describe("Identity & Tenant Isolation", () => {
    it("returns null when tenantId or operatorUserId is empty or whitespace", async () => {
      const res1 = await loadClaireOperatorAdaptationContext({
        tenantId: "",
        operatorUserId: "123",
      });
      expect(res1).toBeNull();

      const res2 = await loadClaireOperatorAdaptationContext({
        tenantId: "tenant_alpha",
        operatorUserId: "   ",
      });
      expect(res2).toBeNull();
    });

    it("does not leak data across distinct tenants or fall back across tenant boundaries", async () => {
      const mockLoader = vi.fn().mockImplementation(async ({ tenantId }) => {
        if (tenantId === "tenant_alpha") {
          return toClaireOperatorAdaptationContext(
            makeMinimalPacket({ tenantId: "tenant_alpha" })
          );
        }
        return null;
      });

      const events: ClaireOperatorContextShadowTelemetryEvent[] = [];
      const onTelemetry = (e: ClaireOperatorContextShadowTelemetryEvent) => events.push(e);

      // Tenant A
      const resA = await runClaireOperatorContextShadow({
        tenantId: "tenant_alpha",
        operatorUserId: "user_1",
        deps: {
          loadOperatorAdaptationContext: mockLoader,
          onOperatorContextShadowTelemetry: onTelemetry,
        },
      });
      expect(resA?.tenantId).toBe("tenant_alpha");

      // Tenant B (unauthorized / unmapped)
      const resB = await runClaireOperatorContextShadow({
        tenantId: "tenant_beta",
        operatorUserId: "user_1",
        deps: {
          loadOperatorAdaptationContext: mockLoader,
          onOperatorContextShadowTelemetry: onTelemetry,
        },
      });
      expect(resB).toBeNull();

      const skipped = events.find(
        e => e.tenantId === "tenant_beta" && e.event === "operator_context_shadow_skipped"
      );
      expect(skipped).toBeDefined();
      expect(skipped?.skipReason).toBe("identity_unresolved");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Feature Flag Behavior
  // -------------------------------------------------------------------------
  describe("Feature Flag Behavior", () => {
    it("defaults to false when environment variable is unset", () => {
      delete process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED;
      expect(isClaireOperatorContextShadowEnabled()).toBe(false);
      expect(isClaireOperatorContextShadowEnabled("tenant_123")).toBe(false);
    });

    it("returns false for 'false' or '0'", () => {
      process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = "false";
      expect(isClaireOperatorContextShadowEnabled()).toBe(false);

      process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = "0";
      expect(isClaireOperatorContextShadowEnabled()).toBe(false);
    });

    it("returns true for global enable ('true', '1', '*')", () => {
      process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = "true";
      expect(isClaireOperatorContextShadowEnabled()).toBe(true);
      expect(isClaireOperatorContextShadowEnabled("tenant_any")).toBe(true);

      process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = "1";
      expect(isClaireOperatorContextShadowEnabled()).toBe(true);

      process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = "*";
      expect(isClaireOperatorContextShadowEnabled()).toBe(true);
    });

    it("supports tenant-specific allowlist", () => {
      process.env.CLAIRE_OPERATOR_CONTEXT_SHADOW_ENABLED = "tenant_alpha,tenant_beta";
      expect(isClaireOperatorContextShadowEnabled("tenant_alpha")).toBe(true);
      expect(isClaireOperatorContextShadowEnabled("tenant_beta")).toBe(true);
      expect(isClaireOperatorContextShadowEnabled("tenant_gamma")).toBe(false);
      expect(isClaireOperatorContextShadowEnabled()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Resilience & Safe Failure (Non-Destructive Shadow)
  // -------------------------------------------------------------------------
  describe("Resilience & Safe Failure (Non-Destructive Shadow)", () => {
    it("emits operator_context_shadow_started and completed on success", async () => {
      const events: ClaireOperatorContextShadowTelemetryEvent[] = [];
      const onTelemetry = (e: ClaireOperatorContextShadowTelemetryEvent) => events.push(e);

      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);

      const result = await runClaireOperatorContextShadow({
        tenantId: "tenant_alpha",
        operatorUserId: "user_42",
        deps: {
          loadOperatorAdaptationContext: async () => adaptation,
          onOperatorContextShadowTelemetry: onTelemetry,
        },
      });

      expect(result).toBe(adaptation);
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe("operator_context_shadow_started");
      expect(events[1].event).toBe("operator_context_shadow_completed");
      expect(events[1].tenantId).toBe("tenant_alpha");
      expect(events[1].canonicalOperatorId).toBe("canonical_op_1");
      expect(events[1].operatorUserId).toBe("user_42");
      expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
      expect(events[1].metadata).toEqual({
        durationMs: expect.any(Number),
        explicitPreferenceCount: 1,
        learnedSignalCount: 1,
        learnedSignalKinds: ["time_preference"],
        uncertaintyReasons: ["no_records"],
        evidenceWindowTruncated: false,
        mappedUserCount: 2,
        evidenceRefCount: 2,
      });
    });

    it("catches loader errors, emits operator_context_shadow_failed, and never throws to caller", async () => {
      const events: ClaireOperatorContextShadowTelemetryEvent[] = [];
      const onTelemetry = (e: ClaireOperatorContextShadowTelemetryEvent) => events.push(e);

      const result = await runClaireOperatorContextShadow({
        tenantId: "tenant_alpha",
        operatorUserId: "user_42",
        deps: {
          loadOperatorAdaptationContext: async () => {
            throw new Error("Simulated database connection failure");
          },
          onOperatorContextShadowTelemetry: onTelemetry,
        },
      });

      expect(result).toBeNull();
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe("operator_context_shadow_started");
      expect(events[1].event).toBe("operator_context_shadow_failed");
      expect(events[1].failureReason).toContain("Simulated database connection failure");
      expect(events[1].durationMs).toBeGreaterThanOrEqual(0);
    });

    it("skips and emits operator_context_shadow_skipped when operator identity is missing", async () => {
      const events: ClaireOperatorContextShadowTelemetryEvent[] = [];
      const onTelemetry = (e: ClaireOperatorContextShadowTelemetryEvent) => events.push(e);

      const result = await runClaireOperatorContextShadow({
        tenantId: "tenant_alpha",
        operatorUserId: "",
        deps: {
          onOperatorContextShadowTelemetry: onTelemetry,
        },
      });

      expect(result).toBeNull();
      expect(events).toHaveLength(2);
      expect(events[0].event).toBe("operator_context_shadow_started");
      expect(events[1].event).toBe("operator_context_shadow_skipped");
      expect(events[1].skipReason).toBe("missing_identity");
    });

    it("telemetry never logs private text, preference values, prompt content, or raw ledger rows", async () => {
      const events: ClaireOperatorContextShadowTelemetryEvent[] = [];
      const onTelemetry = (e: ClaireOperatorContextShadowTelemetryEvent) => events.push(e);

      const packet = makeMinimalPacket({
        card: {
          canonicalOperatorId: "canonical_op_1",
          tenantId: "tenant_alpha",
          explicitPreferences: [
            {
              key: "private_note",
              value: "secret private preference value 12345",
              provenance: "operator_declared",
              observedAt: "2026-10-01T12:00:00.000Z",
              sourceReference: "ref",
            },
          ],
          currentRole: null,
          operatingContext: null,
          uncertainty: [],
        },
      });
      const adaptation = toClaireOperatorAdaptationContext(packet);

      await runClaireOperatorContextShadow({
        tenantId: "tenant_alpha",
        operatorUserId: "user_42",
        deps: {
          loadOperatorAdaptationContext: async () => adaptation,
          onOperatorContextShadowTelemetry: onTelemetry,
        },
      });

      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).not.toContain("secret private preference value 12345");
      expect(serializedEvents).not.toContain("private_note");
    });

    it("defaultEmitClaireOperatorContextShadowTelemetry logs safely via console.info", () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const event: ClaireOperatorContextShadowTelemetryEvent = {
        event: "operator_context_shadow_started",
        tenantId: "tenant_alpha",
      };
      defaultEmitClaireOperatorContextShadowTelemetry(event);
      expect(consoleSpy).toHaveBeenCalledWith("[Claire] operator context shadow", event);
      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // 8. Behavioral Equivalence on runClaireTurn (Shadow OFF == Shadow ON)
  // -------------------------------------------------------------------------
  describe("Behavioral Equivalence on runClaireTurn", () => {
    it("produces 100% identical user-visible speech and turn result whether shadow is disabled or enabled", async () => {
      const baseTurnInput = {
        tenantId: "tenant_alpha",
        operatorUserId: "user_1",
        dayDirectorActorId: "actor_1",
        utterance: "good morning",
        surface: "voice" as const,
        state: {},
        conversationKey: "conv_test_1",
      };

      const now = new Date("2026-10-02T15:00:00.000Z");
      const sharedOverrides = {
        now: () => now,
        timeZone: () => "America/Los_Angeles",
        doctrineTurn: async () => "Good morning Adam. You have 3 deliveries scheduled today.",
      };

      // 1. Run with shadow DISABLED
      const resultOff = await runClaireTurn(
        { ...baseTurnInput, state: {} },
        {
          ...sharedOverrides,
          operatorContextShadowEnabled: () => false,
        }
      );

      // 2. Run with shadow ENABLED
      const telemetryEvents: ClaireOperatorContextShadowTelemetryEvent[] = [];
      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);

      const resultOn = await runClaireTurn(
        { ...baseTurnInput, state: {} },
        {
          ...sharedOverrides,
          operatorContextShadowEnabled: () => true,
          loadOperatorAdaptationContext: async () => adaptation,
          onOperatorContextShadowTelemetry: e => telemetryEvents.push(e),
        }
      );

      // Invariant: Spoken text is identical
      expect(resultOn.speak).toBe(resultOff.speak);
      // Invariant: Turn kind is identical
      expect(resultOn.kind).toBe(resultOff.kind);
      // Invariant: Disclosures and directives are identical
      expect(resultOn.disclosures).toEqual(resultOff.disclosures);
      expect(resultOn.directives).toEqual(resultOff.directives);

      // Verify that shadow execution actually ran and recorded telemetry
      expect(telemetryEvents).toHaveLength(2);
      expect(telemetryEvents[0].event).toBe("operator_context_shadow_started");
      expect(telemetryEvents[1].event).toBe("operator_context_shadow_completed");
    });

    it("awaited synchronously within turn lifetime with zero floating unhandled promises", async () => {
      let shadowCompleted = false;

      const baseTurnInput = {
        tenantId: "tenant_alpha",
        operatorUserId: "user_1",
        dayDirectorActorId: "actor_1",
        utterance: "good morning",
        surface: "voice" as const,
        state: {},
        conversationKey: "conv_test_2",
      };

      const packet = makeMinimalPacket();
      const adaptation = toClaireOperatorAdaptationContext(packet);

      await runClaireTurn(baseTurnInput, {
        now: () => new Date("2026-10-02T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
        doctrineTurn: async () => "Good morning Adam.",
        operatorContextShadowEnabled: () => true,
        loadOperatorAdaptationContext: async () => {
          // Slight delay to simulate async load
          await new Promise(resolve => setTimeout(resolve, 10));
          shadowCompleted = true;
          return adaptation;
        },
      });

      // The shadow load MUST have completed before runClaireTurn resolved
      expect(shadowCompleted).toBe(true);
    });

    it("safe failure in shadow loader does NOT disrupt or fail runClaireTurn", async () => {
      const baseTurnInput = {
        tenantId: "tenant_alpha",
        operatorUserId: "user_1",
        dayDirectorActorId: "actor_1",
        utterance: "good morning",
        surface: "voice" as const,
        state: {},
        conversationKey: "conv_test_3",
      };

      const telemetryEvents: ClaireOperatorContextShadowTelemetryEvent[] = [];

      const result = await runClaireTurn(baseTurnInput, {
        now: () => new Date("2026-10-02T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
        doctrineTurn: async () => "Good morning Adam.",
        operatorContextShadowEnabled: () => true,
        loadOperatorAdaptationContext: async () => {
          throw new Error("Catastrophic database outage during shadow load");
        },
        onOperatorContextShadowTelemetry: e => telemetryEvents.push(e),
      });

      // Turn succeeds completely despite shadow loader failure
      expect(result.speak).toBe("Good morning Adam.");
      expect(telemetryEvents).toHaveLength(2);
      expect(telemetryEvents[0].event).toBe("operator_context_shadow_started");
      expect(telemetryEvents[1].event).toBe("operator_context_shadow_failed");
      expect(telemetryEvents[1].failureReason).toContain("Catastrophic database outage");
    });
  });
});
