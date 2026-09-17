import { DIAGNOSIS_FORBIDDEN_PATTERNS } from "../../shared/behavioralInterventionMapping";
import type { ProximalOutcomeCharacterization } from "./proximalOutcome";

export type ArmDescriptiveCounts = {
  assignedOption: string;
  assignmentCount: number;
  deliveryCount: number;
  startedWithinWindowCount: number;
  startedAfterWindowCount: number;
  startUnknownCount: number;
  completedCount: number;
  verifiedCount: number;
  dismissedWithinWindowCount: number;
  meanStartLatencySeconds: number | null;
};

export type RandomizedExperimentReport = {
  kind: "observed_randomized_outcomes_by_arm";
  causalProductClaim: "insufficient_evidence_for_a_causal_product_claim";
  insufficientSample: boolean;
  availabilityCount: number;
  assignmentCount: number;
  deferredBurden: "unavailable" | "observed";
  arms: ArmDescriptiveCounts[];
  notes: string[];
};

export function describeRandomizedOutcomes(input: {
  outcomes: readonly ProximalOutcomeCharacterization[];
  minSamplePerArm: number;
  deferredProducerExists: boolean;
}): RandomizedExperimentReport {
  const byArm = new Map<string, ProximalOutcomeCharacterization[]>();
  for (const outcome of input.outcomes) {
    const list = byArm.get(outcome.assignedOption) ?? [];
    list.push(outcome);
    byArm.set(outcome.assignedOption, list);
  }
  const arms: ArmDescriptiveCounts[] = [...byArm.entries()].map(([assignedOption, rows]) => {
    const latencies = rows
      .map(row => row.startLatencySeconds)
      .filter((value): value is number => value != null);
    return {
      assignedOption,
      assignmentCount: rows.length,
      deliveryCount: rows.filter(row => row.deliveredAt).length,
      startedWithinWindowCount: rows.filter(row => row.startedWithinWindow === true).length,
      startedAfterWindowCount: rows.filter(row => row.startedWithinWindow === false).length,
      startUnknownCount: rows.filter(row => row.startedWithinWindow === "unknown").length,
      completedCount: rows.filter(row => row.completedAt).length,
      verifiedCount: rows.filter(row => row.verifiedAt).length,
      dismissedWithinWindowCount: rows.filter(row => row.dismissedWithinWindow === true).length,
      meanStartLatencySeconds:
        latencies.length === 0
          ? null
          : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    };
  });
  const insufficientSample =
    input.outcomes.length === 0 ||
    arms.some(arm => arm.assignmentCount < input.minSamplePerArm);
  const report: RandomizedExperimentReport = {
    kind: "observed_randomized_outcomes_by_arm",
    causalProductClaim: "insufficient_evidence_for_a_causal_product_claim",
    insufficientSample,
    availabilityCount: input.outcomes.length,
    assignmentCount: input.outcomes.length,
    deferredBurden: input.deferredProducerExists ? "observed" : "unavailable",
    arms,
    notes: [
      "Descriptive randomized outcomes only. No automatic product claim.",
      insufficientSample
        ? "Insufficient sample for a causal product claim."
        : "Sample meets the configured floor; causal product claims still require a designed analysis, not this report.",
      input.deferredProducerExists
        ? "Explicit DEFERRED rows were present in the supplied outcomes."
        : "DEFERRED producer is not available in production; defer burden is labeled unavailable.",
    ],
  };
  const blob = JSON.stringify(report);
  for (const pattern of DIAGNOSIS_FORBIDDEN_PATTERNS) {
    if (pattern.test(blob)) {
      throw new Error("Experiment report emitted a forbidden causal/diagnostic phrase");
    }
  }
  return report;
}
