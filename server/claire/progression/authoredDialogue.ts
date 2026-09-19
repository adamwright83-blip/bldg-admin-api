/**
 * OPERATOR-AUTHORED CLAIRE DIALOGUE — the authoring surface.
 *
 * This file is data, meant to be edited by hand by the operator. Add a line by
 * appending an entry to AUTHORED_DIALOGUE. Nothing here is generated.
 *
 * RULES (enforced by tests):
 *  - Only lines the operator has explicitly approved may appear. Every entry
 *    carries `approvedBy`. No TODO / placeholder / filler text ever ships.
 *  - Lines must disclose zero biography.
 *  - The categories other than "decline" are intentionally EMPTY in this
 *    commit: the final writing library is authored separately. Behaviors that
 *    need such a line (closing a personal thread with a bespoke closer,
 *    business pivots, actually ending a call) fall back to approved generic
 *    declines or stay dormant until a line exists. See dialogueRegistry.ts.
 */

export type DialogueCategory =
  | "decline" // refuse a personal question without leaking anything
  | "thread_closer" // close the personal subject (not necessarily the call)
  | "business_pivot" // steer back to unresolved business
  | "call_exit" // actually end the call (only when business is complete)
  | "boundary_reinforcement"
  | "recovery_after_failed_generation";

export type DialogueLine = {
  id: string;
  category: DialogueCategory;
  text: string;
  /** Inclusive rapport-band window in which this line may be used. */
  minRapport: 0 | 1 | 2 | 3;
  maxRapport: 0 | 1 | 2 | 3;
  approvedBy: string;
};

const APPROVED_GENERIC_BY = "operator-approved generic decline floor (2026-09-18 brief §28)";

export const AUTHORED_DIALOGUE: readonly DialogueLine[] = [
  { id: "generic_not_that_one", category: "decline", text: "Not that one.", minRapport: 0, maxRapport: 3, approvedBy: APPROVED_GENERIC_BY },
  { id: "generic_pushing_luck", category: "decline", text: "You're pushing your luck.", minRapport: 0, maxRapport: 3, approvedBy: APPROVED_GENERIC_BY },
  { id: "generic_ask_something_else", category: "decline", text: "Ask me something else.", minRapport: 0, maxRapport: 3, approvedBy: APPROVED_GENERIC_BY },
  { id: "generic_leaving_it", category: "decline", text: "I'm leaving that where it is.", minRapport: 0, maxRapport: 3, approvedBy: APPROVED_GENERIC_BY },
  {
    id: "generic_dont_look_pleased",
    category: "decline",
    text: "No. And don't look so pleased with yourself for asking.",
    minRapport: 0,
    maxRapport: 3,
    approvedBy: APPROVED_GENERIC_BY,
  },
];
