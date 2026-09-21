import {
  type AuthoredBeat,
  type BeatPrerequisite,
  type EligibilityCondition,
  type EligibilityGate,
  type EligibilityOutcome,
  type KnowledgeRequirement,
  type NarrativeBeatId,
  type NarrativeEligibilityAudit,
  type NarrativeEligibilityAuditCheck,
  type NarrativeEligibilityResult,
  type NarrativeGraphEdge,
  type NarrativeState,
  type KnowledgeState,
} from "../../shared/narratorOs/contracts";
import { planeKnows, type NarratorSnapshot } from "./store";
import { AUTHORED_BEATS, AUTHORED_GRAPH } from "./registry";
import {
  hasTemporalSameTargetSequence,
  M03_BEAT_ID,
  unconsumedM03QualifyingCycles,
} from "./m03Readiness";
import { productionVerifiedGoldlineEvidence } from "./verifiedGoldlinePersistence";
import {
  isVerifiedGoldlineReceipt,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";

export type EligibilityInput = {
  registry: readonly AuthoredBeat[];
  graph: readonly NarrativeGraphEdge[];
  snapshot: NarratorSnapshot;
  verifiedGoldline: readonly VerifiedGoldlineReceipt[];
  nowMs: number;
  mode: "interactive" | "offscreen";
};

const ELIGIBILITY_AUTHORIZATION_BRAND: unique symbol = Symbol(
  "narratorOs.EligibilityAuthorization"
);

export type EligibilityAuthorization = {
  readonly [ELIGIBILITY_AUTHORIZATION_BRAND]: true;
  beatId: NarrativeBeatId;
  mode: "interactive" | "offscreen";
  tenantId: string;
  operatorUserId: string;
  ledgerLength: number;
};

export function isEligibilityAuthorization(
  value: unknown
): value is EligibilityAuthorization {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as EligibilityAuthorization)[ELIGIBILITY_AUTHORIZATION_BRAND] ===
        true
  );
}

function check(
  gate: NarrativeEligibilityAuditCheck["gate"],
  detail: string,
  passed: boolean | "unresolved_open"
): NarrativeEligibilityAuditCheck {
  return { gate, detail, passed };
}

function goldlineHas(
  receipts: readonly VerifiedGoldlineReceipt[],
  outcomeId: string,
  snapshot: NarratorSnapshot
): boolean {
  return receipts.some(
    receipt =>
      isVerifiedGoldlineReceipt(receipt) &&
      receipt.outcomeId === outcomeId &&
      receipt.tenantId === snapshot.tenantId &&
      receipt.operatorUserId === snapshot.operatorUserId
  );
}

function firedBeatIds(snapshot: NarratorSnapshot): Set<string> {
  return new Set(
    snapshot.ledger
      .filter(entry => entry.kind === "FIRED_AUTHORED_BEAT" && entry.beatId)
      .map(entry => entry.beatId as string)
  );
}

function evaluatePrerequisite(
  prereq: BeatPrerequisite,
  snapshot: NarratorSnapshot,
  fired: Set<string>,
  goldline: readonly VerifiedGoldlineReceipt[],
  beatId?: string
): NarrativeEligibilityAuditCheck {
  switch (prereq.kind) {
    case "hard_beat":
      return check(
        "prerequisite_detail",
        `hard_beat:${prereq.beatId}`,
        fired.has(prereq.beatId)
      );
    case "optional_beat":
      return check(
        "prerequisite_detail",
        `optional_beat:${prereq.beatId}`,
        true
      );
    case "verified_goldline_outcome":
      return check(
        "prerequisite_detail",
        `verified_goldline_outcome:${prereq.outcomeId}`,
        goldlineHas(goldline, prereq.outcomeId, snapshot)
      );
    case "verified_goldline_any":
      return check(
        "prerequisite_detail",
        `verified_goldline_any:${prereq.outcomeIds.join("|")}`,
        prereq.outcomeIds.some(id => goldlineHas(goldline, id, snapshot))
      );
    case "verified_goldline_same_target": {
      const ready =
        beatId === M03_BEAT_ID
          ? unconsumedM03QualifyingCycles(goldline, snapshot).length > 0
          : hasTemporalSameTargetSequence(
              goldline,
              snapshot,
              prereq.priorOutcomeIds,
              prereq.subsequentOutcomeIds
            );
      return check(
        "prerequisite_detail",
        `verified_goldline_same_target:${prereq.priorOutcomeIds.join("|")}->${prereq.subsequentOutcomeIds.join("|")}`,
        ready
      );
    }
    case "knowledge":
      return check(
        "prerequisite_detail",
        `knowledge:${prereq.plane}:${prereq.factId}`,
        planeKnows(snapshot.knowledge, prereq.plane, prereq.factId) ===
          prereq.mustKnow
      );
    case "narrative_state": {
      const actual = snapshot.narrativeState.values[prereq.key];
      const present = actual !== undefined && actual !== null;
      const passed = prereq.equalsAny
        ? present && prereq.equalsAny.includes(String(actual))
        : prereq.equals === undefined
          ? present
          : present && String(actual) === prereq.equals;
      return check(
        "prerequisite_detail",
        `narrative_state:${prereq.key}`,
        passed
      );
    }
    case "world_truth": {
      const fact = snapshot.worldTruth.find(
        entry => entry.factId === prereq.factId
      );
      const present =
        Boolean(fact) && fact?.canonStatus !== "OPEN" && fact?.value !== null;
      return check(
        "prerequisite_detail",
        `world_truth:${prereq.factId}`,
        present
      );
    }
    case "open_policy":
      return check(
        "prerequisite_detail",
        `open_policy:${prereq.policyId}`,
        "unresolved_open"
      );
  }
}

function evaluateCondition(
  condition: EligibilityCondition,
  snapshot: NarratorSnapshot,
  fired: Set<string>,
  goldline: readonly VerifiedGoldlineReceipt[],
  beatId: string
): NarrativeEligibilityAuditCheck {
  if (condition.kind === "never_manufacture") {
    return check(
      "prerequisite_detail",
      `never_manufacture:${condition.claim}`,
      true
    );
  }
  return evaluatePrerequisite(condition, snapshot, fired, goldline, beatId);
}

function evaluateKnowledgeRequirement(
  requirement: KnowledgeRequirement,
  knowledge: KnowledgeState
): NarrativeEligibilityAuditCheck {
  const known = planeKnows(knowledge, requirement.plane, requirement.factId);
  return check(
    "knowledge_detail",
    `${requirement.plane}:${requirement.factId}:mustKnow=${requirement.mustKnow}`,
    known === requirement.mustKnow
  );
}

function holdQuietPassed(
  beat: AuthoredBeat,
  state: NarrativeState,
  nowMs: number
): {
  applied: boolean;
  passed: boolean;
} {
  if (state.closedForwardPaths.includes(beat.id)) {
    return { applied: true, passed: false };
  }
  const window = beat.quietBehavior?.holdWindow;
  if (!window || window.durationMs === null || window.canonStatus === "OPEN") {
    return { applied: false, passed: true };
  }
  const opened = state.holdOpenedAtMs[window.key];
  if (opened === undefined) return { applied: false, passed: true };
  if (nowMs - opened >= window.durationMs) {
    return { applied: true, passed: false };
  }
  return { applied: true, passed: true };
}

function blocksEligibility(
  passed: boolean | "unresolved_open"
): passed is false | "unresolved_open" {
  return passed === false || passed === "unresolved_open";
}

function evaluateBeat(
  beat: AuthoredBeat,
  input: EligibilityInput,
  fired: Set<string>
): NarrativeEligibilityAudit {
  const failedGates: EligibilityGate[] = [];
  const prerequisiteChecks = [
    ...beat.prerequisites.map(prereq =>
      evaluatePrerequisite(
        prereq,
        input.snapshot,
        fired,
        input.verifiedGoldline,
        beat.id
      )
    ),
    ...beat.eligibilityConditions.map(condition =>
      evaluateCondition(
        condition,
        input.snapshot,
        fired,
        input.verifiedGoldline,
        beat.id
      )
    ),
  ];
  const graphDependencyChecks = input.graph
    .filter(edge => edge.toId === beat.id)
    .map(edge => {
      if (edge.kind === "open_unresolved" || edge.canonStatus === "OPEN") {
        return check(
          "graph_detail",
          `open_unresolved:${edge.policyId ?? edge.kind}`,
          "unresolved_open"
        );
      }
      if (edge.kind === "optional" || edge.kind === "parallel") {
        return check(
          "graph_detail",
          `${edge.kind}:${edge.fromId ?? "root"}`,
          true
        );
      }
      if (edge.kind === "hard_prereq") {
        if (!edge.fromId) {
          return check("graph_detail", "hard_prereq:unnamed", false);
        }
        return check(
          "graph_detail",
          `hard_prereq:${edge.fromId}`,
          fired.has(edge.fromId)
        );
      }
      return check(
        "graph_detail",
        `${edge.kind}:${edge.fromId ?? "root"}`,
        true
      );
    });
  const knowledgeRequirementChecks = beat.knowledgeRequirements.map(
    requirement =>
      evaluateKnowledgeRequirement(requirement, input.snapshot.knowledge)
  );
  const goldlineIds = [
    ...beat.prerequisites,
    ...beat.eligibilityConditions,
  ].flatMap(item => {
    if (item.kind === "verified_goldline_outcome") return [item.outcomeId];
    return [];
  });
  const verifiedGoldlineEvidenceChecks = goldlineIds.map(outcomeId =>
    check(
      "prerequisite_detail",
      `goldline:${outcomeId}`,
      goldlineHas(input.verifiedGoldline, outcomeId, input.snapshot)
    )
  );

  if (beat.canonStatus === "OPEN") failedGates.push("canon_status_open");

  if (beat.eligibilityDefinition !== "COMPLETE") {
    failedGates.push("incomplete_eligibility");
  }

  const prereqFailed = prerequisiteChecks.some(item =>
    blocksEligibility(item.passed)
  );
  if (prereqFailed) {
    if (prerequisiteChecks.some(item => item.passed === "unresolved_open")) {
      failedGates.push("open_unresolved");
    }
    if (prerequisiteChecks.some(item => item.passed === false)) {
      failedGates.push("prerequisite");
    }
  }

  const graphOpen = graphDependencyChecks.some(
    item => item.passed === "unresolved_open"
  );
  const graphFailed = graphDependencyChecks.some(item => item.passed === false);
  if (graphOpen) failedGates.push("open_unresolved");
  if (graphFailed) failedGates.push("graph_dependency");

  const knowledgeFailed = knowledgeRequirementChecks.some(
    item => item.passed === false
  );
  if (knowledgeFailed) failedGates.push("knowledge_requirement");

  const goldlineFailed = verifiedGoldlineEvidenceChecks.some(
    item => item.passed === false
  );
  if (goldlineFailed) failedGates.push("verified_goldline_evidence");

  const alreadyFired = fired.has(beat.id);
  if (alreadyFired && beat.repeatability === "non_repeatable") {
    failedGates.push("already_fired");
    failedGates.push("repeatability");
  }

  const offscreenPermission = beat.mayFireOffscreen === true;
  if (input.mode === "offscreen" && !offscreenPermission) {
    failedGates.push("offscreen_permission");
  }

  const timeHoldQuiet = holdQuietPassed(
    beat,
    input.snapshot.narrativeState,
    input.nowMs
  );
  if (!timeHoldQuiet.passed) failedGates.push("time_hold_quiet");

  const pass = failedGates.length === 0;
  return {
    beatId: beat.id,
    canonStatus: beat.canonStatus,
    candidateConsidered: true,
    eligibilityDefinition: beat.eligibilityDefinition,
    prerequisiteChecks,
    graphDependencyChecks,
    knowledgeRequirementChecks,
    verifiedGoldlineEvidenceChecks,
    repeatability: beat.repeatability,
    alreadyFired,
    offscreenPermission,
    timeHoldQuiet,
    visibility: {
      playerVisibility: beat.playerVisibility,
      defaultSurface: beat.defaultSurface,
    },
    pass,
    failedGates: [...new Set(failedGates)],
    finalOutcome: pass ? "pass" : "fail",
  };
}

export function evaluateEligibility(
  input: EligibilityInput
): NarrativeEligibilityResult {
  const fired = firedBeatIds(input.snapshot);
  const audit = input.registry.map(beat => evaluateBeat(beat, input, fired));
  const passing = audit.filter(entry => entry.pass);
  const passingBeats = passing.map(
    entry => input.registry.find(beat => beat.id === entry.beatId)!
  );

  if (passing.length === 0) {
    return {
      outcome: "NO_ELIGIBLE",
      eligibleBeatIds: [],
      withheldBeatIds: [],
      audit,
    };
  }

  const surfaceable = passingBeats.filter(beat => beat.defaultSurface);
  if (surfaceable.length === 0) {
    return {
      outcome: "ELIGIBLE_WITHHELD",
      eligibleBeatIds: [],
      withheldBeatIds: passingBeats.map(beat => beat.id),
      audit,
    };
  }

  return {
    outcome: "ELIGIBLE",
    eligibleBeatIds: surfaceable.map(beat => beat.id),
    withheldBeatIds: passingBeats
      .filter(beat => !beat.defaultSurface)
      .map(beat => beat.id),
    audit,
  };
}

/**
 * Production eligibility. Caller-supplied registry/graph are ignored.
 * Goldline evidence is persisted ingested receipts, unioned with live
 * branded receipts. Unbranded caller objects are not authority.
 * Isolated tests may still call evaluateEligibility with a local catalog.
 */
export function evaluateProductionEligibility(
  input: EligibilityInput
): NarrativeEligibilityResult {
  return evaluateEligibility({
    snapshot: input.snapshot,
    verifiedGoldline: productionVerifiedGoldlineEvidence(
      input.snapshot,
      input.verifiedGoldline
    ),
    nowMs: input.nowMs,
    mode: input.mode,
    registry: AUTHORED_BEATS,
    graph: AUTHORED_GRAPH,
  });
}

export function issueEligibilityAuthorizations(
  result: NarrativeEligibilityResult,
  input: EligibilityInput
): readonly EligibilityAuthorization[] {
  if (result.outcome !== "ELIGIBLE") return [];
  return result.eligibleBeatIds.map(beatId => ({
    [ELIGIBILITY_AUTHORIZATION_BRAND]: true as const,
    beatId,
    mode: input.mode,
    tenantId: input.snapshot.tenantId,
    operatorUserId: input.snapshot.operatorUserId,
    ledgerLength: input.snapshot.ledger.length,
  }));
}

export function eligibilityMutates(_result: NarrativeEligibilityResult): false {
  return false;
}

export function outcomeOfPassing(
  beats: readonly AuthoredBeat[]
): EligibilityOutcome {
  if (beats.length === 0) return "NO_ELIGIBLE";
  if (beats.every(beat => beat.defaultSurface === false))
    return "ELIGIBLE_WITHHELD";
  return "ELIGIBLE";
}

export type { NarrativeBeatId };
