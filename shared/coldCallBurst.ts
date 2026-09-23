export const COLD_CALL_TARGET_STATUSES = [
  "pending",
  "selected",
  "live",
  "completed",
] as const;

export type ColdCallTargetStatus = (typeof COLD_CALL_TARGET_STATUSES)[number];

export type ColdCallTarget = {
  id: string;
  entityId: string;
  missionId: number;
  companyName: string;
  phoneNumber: string;
  eligibility: "eligible";
  reason: string;
  sourceReference: string;
  coaching: { openingLine: string; provenance: string };
  status: ColdCallTargetStatus;
  position: number;
  outcome: string | null;
};

export const COLD_CALL_ROLLING_STATUSES = [
  "dialing_rep",
  "rep_connected",
  "dialing_customer",
  "customer_connected",
  "completed_success",
  "completed_no_connect",
  "failed",
] as const;

export type ColdCallRollingStatus = (typeof COLD_CALL_ROLLING_STATUSES)[number];

export const COLD_CALL_ROLLING_TERMINAL_STATUSES = [
  "completed_success",
  "completed_no_connect",
  "failed",
] as const;

/** Transport status from sales_call_attempts. Not a commercial outcome. */
export type ColdCallRollingCall = {
  attemptId: number;
  targetId: string;
  status: ColdCallRollingStatus;
  failureReason: string | null;
  companyName: string;
  phoneNumber: string;
};

export const COLD_CALL_CALLER_ID_UNVERIFIED_MESSAGE =
  "Your cell must be verified as an outgoing caller ID in Twilio before Goldline can roll this call.";

export function coldCallRollingStatusCopy(input: {
  status: ColdCallRollingStatus;
  companyName: string;
}): string {
  switch (input.status) {
    case "dialing_rep":
      return "Calling your phone…";
    case "rep_connected":
      return "You're connected.";
    case "dialing_customer":
      return `Calling ${input.companyName}…`;
    case "customer_connected":
      return `Connected to ${input.companyName}.`;
    case "completed_success":
    case "completed_no_connect":
    case "failed":
      return "Call ended. Log what actually happened.";
  }
}

export function isColdCallRollingTerminal(status: ColdCallRollingStatus): boolean {
  return (COLD_CALL_ROLLING_TERMINAL_STATUSES as readonly string[]).includes(
    status
  );
}

export type ColdCallBatch = {
  id: string;
  targets: ColdCallTarget[];
  createdAt: string;
  sourceReferences: string[];
  status: "active" | "completed";
  combo: number;
  completedCount: number;
  totalTargets: number;
  /** Latest transport attempt for the live target, when one exists. */
  rollingCall: ColdCallRollingCall | null;
};

export type ColdCallEligibilityCandidate = {
  missionId: number;
  missionStatus: string;
  assignedTo: string | null;
  actorId: string;
  phoneNumber: string | null;
  contactSource: string | null;
  preferredChannel: string | null;
  withinServiceArea: boolean | null;
  alreadyCompleted: boolean;
};

export function coldCallEligibility(candidate: ColdCallEligibilityCandidate): {
  eligible: boolean;
  reason: string;
} {
  if (candidate.assignedTo !== candidate.actorId) {
    return {
      eligible: false,
      reason: "Mission is assigned to another field actor",
    };
  }
  if (!["phone_ready", "preparing"].includes(candidate.missionStatus)) {
    return {
      eligible: false,
      reason: "Mission state does not permit a cold call",
    };
  }
  if (!candidate.phoneNumber?.trim()) {
    return { eligible: false, reason: "No sourced phone number" };
  }
  if (!candidate.contactSource || candidate.contactSource === "unknown") {
    return { eligible: false, reason: "Contact provenance is unavailable" };
  }
  if (
    candidate.preferredChannel &&
    !["phone", "unknown"].includes(candidate.preferredChannel)
  ) {
    return {
      eligible: false,
      reason: "Contact does not permit the phone channel",
    };
  }
  if (candidate.withinServiceArea === false) {
    return {
      eligible: false,
      reason: "Account is outside the configured service area",
    };
  }
  if (candidate.alreadyCompleted) {
    return { eligible: false, reason: "A call outcome is already recorded" };
  }
  return {
    eligible: true,
    reason:
      "Assigned call-ready mission with a sourced permitted phone contact",
  };
}

export function coldCallAmmo(batch: ColdCallBatch) {
  return {
    remaining: batch.targets.filter(target => target.status !== "completed")
      .length,
    total: batch.totalTargets,
    completed: batch.completedCount,
  };
}

export function comboAfterChain(input: {
  currentCombo: number;
  selectedNextTarget: boolean;
  hasEligibleNextTarget: boolean;
}) {
  if (!input.hasEligibleNextTarget) {
    return { combo: input.currentCombo, result: "sweep_complete" as const };
  }
  if (!input.selectedNextTarget) {
    return { combo: 0, result: "combo_break" as const };
  }
  return {
    combo: Math.max(1, input.currentCombo) + 1,
    result: "combo_held" as const,
  };
}
