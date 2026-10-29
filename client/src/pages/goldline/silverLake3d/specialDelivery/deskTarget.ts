import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";

const IN_PROGRESS = new Set(["compose_handoff_opened", "operator_reported_sent", "scheduled", "saved_draft", "explicitly_approved", "due_operator_action"]);

/**
 * One situation at a time, and the same one until it is settled: someone the operator may contact who has not already
 * accepted or been observed receiving a message. The customer with a draft saved at the desk first, then someone
 * already in progress, then the first neighbour the mission lists.
 */
export function pickDeskTarget(targets: CozyProjectedTarget[], unfinished: { customerId: string } | null): CozyProjectedTarget | null {
  const open = targets.filter(
    t => t.hasConsent && t.status !== "accepted" && t.communicationState !== "send_observed" && t.communicationState !== "consent_blocked"
  );
  const savedHere = unfinished ? open.find(t => t.customerId === unfinished.customerId) : undefined;
  if (savedHere) return savedHere;
  const inProgress = open.find(t => IN_PROGRESS.has(String(t.silverLakeStatus?.message)));
  return inProgress ?? open[0] ?? null;
}
