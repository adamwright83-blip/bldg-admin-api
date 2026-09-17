import type { ActionGrammar } from "./actionGrammar";

/** Stable behavioral subject for ops-task ledger rows. Slice 1 correlation. */
export function opsTaskBehavioralSubject(taskId: number | string): string {
  return `ops_task:${String(taskId).replace(/^ops_task:/, "")}`;
}

/**
 * Subject used to assemble history for a grammar.
 * Numeric / ops_task business ids map to production ops-task correlation.
 * Other grammars get a grammar-scoped key that will not mix ops-task rows.
 */
export function behavioralSubjectFromGrammar(grammar: ActionGrammar): string {
  const actionId = grammar.businessActionId?.trim() || null;
  if (actionId && /^ops_task:\d+$/.test(actionId)) return actionId;
  if (actionId && /^\d+$/.test(actionId)) return opsTaskBehavioralSubject(actionId);
  if (grammar.occurrenceId != null) return opsTaskBehavioralSubject(grammar.occurrenceId);
  return `grammar:${grammar.kind}:${actionId ?? "none"}`;
}
