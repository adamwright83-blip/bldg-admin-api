/**
 * Conflict monitoring.
 *
 * Inspects the cognitive situation before a decision is made and reports where things
 * do not line up. It emits control signals and a SUGGESTION; it never chooses the
 * response. Executive Function decides what to do about a conflict.
 *
 * There is deliberately no `personal_business_conflict`: personal state is simply
 * prohibited from altering business truth, so there is nothing to reconcile.
 */

import type { Conflict, TaskSet } from "../contracts/control";
import type { EvidenceItem, PriorClaimRecheckResult } from "../contracts/evidence";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";

function payload<T>(item: EvidenceItem): T {
  return (item.payload ?? {}) as T;
}

function current(evidence: readonly EvidenceItem[]): EvidenceItem[] {
  return evidence.filter(item => item.authoritativeFor.includes("current_business_truth"));
}

function historical(evidence: readonly EvidenceItem[]): EvidenceItem[] {
  return evidence.filter(item => item.authoritativeFor.includes("historical_observation"));
}

export function monitorConflicts(input: {
  perceived: PerceivedTurn;
  memory: WorkingMemorySnapshot;
  evidence: readonly EvidenceItem[];
  taskSets: readonly TaskSet[];
  recheck: PriorClaimRecheckResult | null;
}): Conflict[] {
  const { perceived, memory, evidence, taskSets, recheck } = input;
  const conflicts: Conflict[] = [];

  // ── Identity: one mention, several possible referents ─────────────────────
  for (const item of evidence) {
    if (!item.id.startsWith("contact_account_resolution:")) continue;
    const resolved = payload<{ resolutionKind?: string; mention?: string; candidateAccountIds?: number[] }>(item);
    if (resolved.resolutionKind === "ambiguous") {
      conflicts.push({
        kind: "identity_conflict",
        detail: `"${resolved.mention}" matches ${resolved.candidateAccountIds?.length ?? 0} accounts`,
        evidenceIds: [item.id],
        // Do not pick one arbitrarily. Ask.
        suggests: "clarify",
      });
    }
  }

  // ── Coverage: a number exists but the domain is not exhaustively covered ──
  for (const item of current(evidence)) {
    if (item.coverage && !item.coverage.complete) {
      conflicts.push({
        kind: "coverage_conflict",
        detail: `coverage gaps: ${item.coverage.gaps.join(", ")}`,
        evidenceIds: [item.id],
        suggests: "preserve_uncertainty",
      });
    }
    if (item.freshness?.failedSources.length) {
      conflicts.push({
        kind: "current_source_conflict",
        detail: `sources failed to load: ${item.freshness.failedSources.join(", ")}`,
        evidenceIds: [item.id],
        suggests: "preserve_uncertainty",
      });
    }
  }

  // ── Current vs historical ─────────────────────────────────────────────────
  // History that looks like it settles the question, alongside current state that
  // does not agree. Current wins for the present; history stays sayable as history.
  const currentItems = current(evidence);
  const historicalItems = historical(evidence);
  if (currentItems.length && historicalItems.length) {
    const historyAsserts = historicalItems.some(item => {
      const text = payload<{ text?: string }>(item).text ?? "";
      return /\b(?:agreed|confirmed|signed|said (?:yes|she'd|he'd)|done|completed|sorted)\b/i.test(text);
    });
    const currentShowsOpen = currentItems.some(item => {
      const open = payload<{ openTotal?: number; status?: string }>(item);
      return (typeof open.openTotal === "number" && open.openTotal > 0) || open.status === "open";
    });
    if (historyAsserts && currentShowsOpen) {
      conflicts.push({
        kind: "current_vs_historical",
        detail: "what was said earlier suggests it was settled; current state still shows it open",
        evidenceIds: [...currentItems, ...historicalItems].map(item => item.id),
        // The current system remains authoritative for the present.
        suggests: "suppress_stale",
      });
    }
  }

  // ── Temporal: working memory holds one date, this turn names another ──────
  const pendingHints = memory.pendingProposal?.hints ?? [];
  const DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/i;
  const heldDay = pendingHints.map(hint => hint.match(DAY)?.[1]?.toLowerCase()).find(Boolean) ?? null;
  const spokenDay = perceived.temporalReferences.map(term => term.toLowerCase()).find(term => DAY.test(term)) ?? null;
  if (heldDay && spokenDay && heldDay !== spokenDay) {
    conflicts.push({
      kind: "temporal_conflict",
      detail: `pending item says ${heldDay}; this turn says ${spokenDay}`,
      evidenceIds: [],
      // The operator is correcting, not contradicting themselves.
      suggests: "revise_belief",
    });
  }

  // ── Task: an old pending item competing with a clearly new request ────────
  const holdingPending = Boolean(memory.pendingProposal || memory.pendingBriefing || memory.pendingAccountFollowUp);
  const newTask = taskSets.some(set => set.kind === "business_query" || set.kind === "account_judgment");
  if (holdingPending && newTask && !perceived.acknowledgement && !perceived.correction) {
    conflicts.push({
      kind: "task_conflict",
      detail: "a pending item is open while the operator asked about something else",
      evidenceIds: [],
      suggests: "suppress_stale",
    });
  }

  // ── Authority: action-shaped text without authorisation to execute ────────
  if (perceived.mayProposeWorkHint && !perceived.explicitActionRequest && !perceived.operatorWorkCommitment) {
    conflicts.push({
      kind: "authority_conflict",
      detail: "the utterance looks action-like but authorises nothing",
      evidenceIds: [],
      suggests: "inhibit",
    });
  }

  // ── Prior claim: a fresh reread that disagrees with what was said ─────────
  if (recheck) {
    if (recheck.outcome === "changed" || recheck.outcome === "superseded") {
      conflicts.push({
        kind: "prior_claim_conflict",
        detail: `fresh reread disagrees with the earlier answer (${recheck.outcome})`,
        evidenceIds: recheck.evidenceIds,
        suggests: "revise_belief",
      });
    } else if (recheck.resolution !== "fresh_query" && perceived.businessIntent === "correctness_challenge") {
      conflicts.push({
        kind: "prior_claim_conflict",
        detail: "the claim was challenged but could not be freshly re-read",
        evidenceIds: recheck.evidenceIds,
        suggests: "preserve_uncertainty",
      });
    }
  }

  return conflicts;
}

/** Does anything here call for another retrieval round rather than an answer? */
export function conflictsWantMoreCognition(conflicts: readonly Conflict[]): boolean {
  return conflicts.some(conflict => conflict.suggests === "verify" || conflict.suggests === "clarify");
}
