/**
 * Control allocation: how much cognition this turn has earned, and when to stop.
 *
 * The principle worth keeping from the research is simply that MORE COGNITION HAS A
 * COST, so the executive escalates only when another step is likely to change or
 * materially improve the decision. There is no attempt to compute an expected value
 * of control; this is a deterministic policy over the control state.
 *
 * "Thanks."                       → fast
 * "What were my last five sales?" → fast, with one authoritative read
 * "Are you sure?"                 → verify
 * "What should I do about Dana?"  → deliberate
 * "Dana at which account?"        → clarify
 */

import type {
  Conflict,
  ControlMode,
  EpistemicState,
  StoppingReason,
  TaskSet,
} from "../contracts/control";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { RetrievalRequest } from "../contracts/retrieval";

/** Hard ceiling on executive looping. A turn must always terminate. */
export const MAX_RETRIEVAL_ROUNDS = 2;
export const MAX_DELIBERATION_DEPTH = 3;

export function allocateControl(input: {
  perceived: PerceivedTurn;
  taskSets: readonly TaskSet[];
  conflicts: readonly Conflict[];
  epistemic: EpistemicState;
}): ControlMode {
  const { perceived, taskSets, conflicts, epistemic } = input;
  const kinds = new Set(taskSets.map(set => set.kind));

  // Ambiguous identity cannot be reasoned away — only the operator can settle it.
  if (conflicts.some(conflict => conflict.suggests === "clarify")) return "clarify";

  // A challenged claim, or evidence we have reason to distrust, needs a real reread.
  if (perceived.businessIntent === "correctness_challenge") return "verify";
  if (conflicts.some(conflict => conflict.kind === "prior_claim_conflict")) return "verify";
  if (epistemic.freshness === "stale" || epistemic.classification === "conflicting") return "verify";

  // Advice, and anything with several interacting frames, deserves deliberation.
  if (kinds.has("account_judgment")) return "deliberate";
  if (kinds.has("broad_planning")) return "deliberate";
  if (conflicts.length > 1) return "deliberate";
  if (kinds.size > 1 && kinds.has("business_query") && kinds.has("personal_disclosure")) return "deliberate";

  return "fast";
}

/**
 * Would another cognitive step plausibly resolve something still open?
 *
 * This is the guard against both under-thinking and pointless repetition: re-running a
 * reader that already returned nothing will return nothing again, so unavailability is
 * an answer rather than a reason to loop.
 */
export function anotherRoundIsWorthwhile(input: {
  mode: ControlMode;
  epistemic: EpistemicState;
  conflicts: readonly Conflict[];
  retrievalRounds: number;
  /** Requests already issued this turn, to catch duplicates. */
  issued: readonly RetrievalRequest[];
  /** What the next round would ask for. */
  proposed: readonly RetrievalRequest[];
}): { worthwhile: boolean; reason: StoppingReason | null } {
  const { mode, epistemic, conflicts, retrievalRounds, issued, proposed } = input;

  if (retrievalRounds >= MAX_RETRIEVAL_ROUNDS) {
    return { worthwhile: false, reason: "budget_exhausted" };
  }
  if (mode === "clarify") {
    // Only the operator can resolve this; retrieving again cannot.
    return { worthwhile: false, reason: "clarification_required" };
  }
  if (!proposed.length) {
    return { worthwhile: false, reason: "low_expected_value" };
  }

  // Never ask the same question twice hoping for a different answer.
  const seen = new Set(issued.map(fingerprintRequest));
  const genuinelyNew = proposed.filter(request => !seen.has(fingerprintRequest(request)));
  if (!genuinelyNew.length) {
    return { worthwhile: false, reason: "low_expected_value" };
  }

  /**
   * Something is actually open that another read could close.
   *
   * DELIBERATE counts as open on its own. Resolving who "Dana" is makes the bundle
   * look sufficient, but a judgment has not gathered anything it can reason over until
   * the scoped reads have run — that second pass is the whole reason the mode exists.
   */
  const open =
    mode === "deliberate" ||
    epistemic.sufficiency !== "sufficient" ||
    epistemic.unresolvedReferences.length > 0 ||
    conflicts.some(conflict => conflict.suggests === "verify" || conflict.suggests === "revise_belief");
  if (!open) return { worthwhile: false, reason: "evidence_sufficient" };

  // A reader that already reported nothing will not report something on a retry.
  if (epistemic.sufficiency === "unavailable" && retrievalRounds > 0) {
    return { worthwhile: false, reason: "information_unavailable" };
  }

  return { worthwhile: true, reason: null };
}

/** Stable identity for a retrieval request, so duplicates are detectable. */
export function fingerprintRequest(request: RetrievalRequest): string {
  const parts: string[] = [request.compartment, request.kind];
  if ("mentions" in request && request.mentions?.length) parts.push(request.mentions.join("|"));
  if ("accountId" in request && request.accountId != null) parts.push(String(request.accountId));
  if ("receiptId" in request) parts.push(request.receiptId);
  if ("mode" in request) parts.push(request.mode);
  if ("terms" in request && Array.isArray(request.terms) && request.terms.length) {
    parts.push(request.terms.join("|"));
  }
  if ("query" in request && request.query) {
    const query = request.query as { metric?: string; limit?: number; customerName?: string | null };
    parts.push(`${query.metric ?? ""}:${query.limit ?? ""}:${query.customerName ?? ""}`);
  }
  return parts.join("::");
}

/** Why the turn stopped, when it stopped for a reason other than a spent budget. */
export function terminalReason(input: {
  mode: ControlMode;
  epistemic: EpistemicState;
}): StoppingReason {
  if (input.mode === "clarify") return "clarification_required";
  if (input.epistemic.sufficiency === "sufficient") return "evidence_sufficient";
  if (input.epistemic.sufficiency === "unavailable") return "information_unavailable";
  return "low_expected_value";
}
