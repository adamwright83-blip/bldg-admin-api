import { describe, expect, it } from "vitest";
import type { ActionGrammar } from "./actionGrammar";
import type { FictionTemplate } from "./fictionTemplate";
import { STANDARD_PRESENTATION } from "./behavioralInterventionMapping";
import { DIAGNOSIS_FORBIDDEN_PATTERNS } from "./behavioralInterventionMapping";
import {
  BEHAVIORAL_EXPERIMENT_POLICY_V1,
  type BehavioralExperimentPolicy,
} from "./behavioralExperimentPolicy";
import {
  distributionSumsToOne,
  drawEqualProbabilityArm,
  freezeExperimentalOptionSet,
  preferredTemplateIdFromAssignedOption,
  presentationDecisionPointId,
} from "./behavioralExperimentAssignment";
import { selectPreferredFictionPresentation } from "./behavioralFictionSelection";

const GRAMMAR: ActionGrammar = {
  kind: "VISIT_LOCATION",
  businessActionId: "42",
  occurrenceId: 42,
  sourceType: "recovery",
  count: 1,
  locations: ["100 Wilshire"],
  channel: "in_person",
  requiresTravel: true,
  requiresDriving: false,
  timerSafe: true,
  sensitiveConversation: false,
};

const WALK: FictionTemplate = {
  id: "beacon-walk-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["VISIT_LOCATION"],
  title: "BEACON WALK",
  briefing: () => "x",
  physicalInstruction: () => "y",
  stakes: "z",
  successTreatment: { headline: "a", detail: "b" },
  failureTreatment: { headline: "c", detail: "d" },
  worldReturnTreatment: "w",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};

const SEALED: FictionTemplate = { ...WALK, id: "sealed-doors-v1" };
const UNSAFE: FictionTemplate = {
  ...WALK,
  id: "unsafe-timer-drive-v1",
  compatibleGrammarKinds: ["CALL_PERSON"],
  timerEligible: true,
  attentionSafetyClass: "unsafe_while_driving",
};

const ENABLED: BehavioralExperimentPolicy = { ...BEHAVIORAL_EXPERIMENT_POLICY_V1, enabled: true };

describe("Slice 5 experiment policy", () => {
  it("production policy is disabled by default", () => {
    expect(BEHAVIORAL_EXPERIMENT_POLICY_V1.enabled).toBe(false);
    expect(BEHAVIORAL_EXPERIMENT_POLICY_V1.includeStandardPresentation).toBe(true);
    expect(BEHAVIORAL_EXPERIMENT_POLICY_V1.equalWeights).toBe(true);
  });

  it("disabled policy does not freeze a distribution", () => {
    const frozen = freezeExperimentalOptionSet({
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: BEHAVIORAL_EXPERIMENT_POLICY_V1,
    });
    expect(frozen.distribution).toBeNull();
    expect(frozen.skipReason).toBe("policy_disabled");
  });

  it("includes STANDARD_PRESENTATION and only eligible fiction ids", () => {
    const frozen = freezeExperimentalOptionSet({
      grammar: GRAMMAR,
      registry: [UNSAFE, SEALED, WALK],
      policy: ENABLED,
    });
    expect(frozen.distribution?.options).toEqual([
      STANDARD_PRESENTATION,
      "beacon-walk-v1",
      "sealed-doors-v1",
    ]);
    expect(frozen.distribution?.options).not.toContain("unsafe-timer-drive-v1");
    expect(distributionSumsToOne(frozen.distribution!.probabilities)).toBe(true);
  });

  it("skips driving when the policy excludes it", () => {
    const frozen = freezeExperimentalOptionSet({
      grammar: { ...GRAMMAR, requiresDriving: true },
      registry: [WALK, SEALED],
      policy: ENABLED,
    });
    expect(frozen.skipReason).toBe("driving_excluded");
  });

  it("skips emergency", () => {
    const frozen = freezeExperimentalOptionSet({
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      policy: ENABLED,
      emergency: true,
    });
    expect(frozen.skipReason).toBe("emergency");
  });

  it("decision points are not the behavioral subject", () => {
    expect(presentationDecisionPointId({ correlationId: "ops_task:42", occasionId: "evt-1" })).toBe(
      "ops_task:42:offer:evt-1"
    );
    expect(
      presentationDecisionPointId({ correlationId: "ops_task:42", occasionId: "evt-2" })
    ).not.toBe("ops_task:42");
  });

  it("STANDARD_PRESENTATION maps to a null Director preferred id", () => {
    expect(preferredTemplateIdFromAssignedOption(STANDARD_PRESENTATION)).toBeNull();
    expect(preferredTemplateIdFromAssignedOption("beacon-walk-v1")).toBe("beacon-walk-v1");
  });

  it("equal draw records real 1/N, not a hash", () => {
    const first = drawEqualProbabilityArm({
      options: [STANDARD_PRESENTATION, "beacon-walk-v1"],
      randomInt: () => 0,
    });
    const second = drawEqualProbabilityArm({
      options: [STANDARD_PRESENTATION, "beacon-walk-v1"],
      randomInt: () => 1,
    });
    expect(first.assignedOption).toBe(STANDARD_PRESENTATION);
    expect(second.assignedOption).toBe("beacon-walk-v1");
    expect(first.assignmentProbability).toBe(0.5);
    expect(second.assignmentProbability).toBe(0.5);
  });

  it("Slice 4 deterministic assignments still have null probability", () => {
    const decision = selectPreferredFictionPresentation({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      grammar: GRAMMAR,
      registry: [WALK, SEALED],
      events: [],
    });
    expect(decision.assignmentMechanism).toBe("deterministic_policy");
    expect(decision.assignmentProbability).toBeNull();
  });

  it("does not mutate ActionGrammar while choosing an arm", () => {
    const grammar = { ...GRAMMAR };
    const before = JSON.stringify(grammar);
    freezeExperimentalOptionSet({ grammar, registry: [WALK, SEALED], policy: ENABLED });
    drawEqualProbabilityArm({
      options: [STANDARD_PRESENTATION, "beacon-walk-v1"],
      randomInt: () => 1,
    });
    expect(JSON.stringify(grammar)).toBe(before);
  });
});

describe("Slice 5 forbidden language", () => {
  it("policy and assignment helpers do not claim efficacy", () => {
    const blob = JSON.stringify({
      ...BEHAVIORAL_EXPERIMENT_POLICY_V1,
      note: "observed randomized outcomes by arm",
    });
    for (const pattern of DIAGNOSIS_FORBIDDEN_PATTERNS) {
      expect(blob).not.toMatch(pattern);
    }
  });
});
