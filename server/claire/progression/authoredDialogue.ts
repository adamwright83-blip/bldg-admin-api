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
 *  - Authored for the locked Claire voice: British, measured, concise, dry, observant, hard to
 *    impress; no therapy language, no gushing, no flirtation, no exclamation marks, no numbers, no
 *    biography. Rapport warms REGISTER (tone of a refusal), never what she will tell.
 *  - Categories in use: decline (per rapport band), thread_closer, business_pivot, call_exit.
 *  - `recovery_after_failed_generation` deliberately has NO dedicated lines: a distinct recovery line
 *    would reveal that an answer existed. A lost reveal therefore uses the ordinary decline lines and
 *    is indistinguishable from a refusal. `boundary_reinforcement` is not used by any code path yet.
 *  - Lines never announce progress, unlocks, levels, budgets or counters.
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
const AUTHORED_BY = "operator-directed authoring, locked Claire voice (2026-09-19 closeout brief, step 5)";
const line = (
  id: string,
  category: DialogueCategory,
  text: string,
  minRapport: 0 | 1 | 2 | 3,
  maxRapport: 0 | 1 | 2 | 3
): DialogueLine => ({ id, category, text, minRapport, maxRapport, approvedBy: AUTHORED_BY });

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

  // --- decline, by rapport band: the register warms; the answer never changes ---
  line("decline_r0_not_get_into", "decline", "That's not something I get into.", 0, 0),
  line("decline_r0_what_else", "decline", "No. What else?", 0, 0),
  line("decline_r0_keep_to_work", "decline", "I keep to the work.", 0, 0),
  line("decline_r1_can_ask", "decline", "You can ask. I won't answer.", 1, 1),
  line("decline_r1_nice_try", "decline", "Nice try. Ask me something useful.", 1, 1),
  line("decline_r1_not_that_one", "decline", "Not that one, I'm afraid.", 1, 1),
  line("decline_r2_keep_trying", "decline", "You really do keep trying that one.", 2, 3),
  line("decline_r2_exhausting", "decline", "Confidence remains one of your more exhausting qualities.", 2, 3),
  line("decline_r2_persistence", "decline", "Persistence is a fine quality in sales. It's still no.", 2, 3),

  // --- closing the personal subject (never the call), no counters ---
  line("closer_all_all_youre_getting", "thread_closer", "That's all you're getting.", 0, 1),
  line("closer_all_greedy", "thread_closer", "No. You're getting greedy.", 0, 1),
  line("closer_all_done_with_that", "thread_closer", "We're done with that.", 0, 1),
  line("closer_r2_said_what", "thread_closer", "I've said what I'm going to say.", 2, 3),
  line("closer_r2_quite_enough", "thread_closer", "That's quite enough of that.", 2, 3),
  line("closer_r2_shut", "thread_closer", "That door's shut. Next.", 2, 3),

  // --- steering back to unresolved business ---
  line("pivot_now_the_work", "business_pivot", "Now, the work.", 0, 3),
  line("pivot_back_to_it", "business_pivot", "Right. Back to it.", 0, 3),
  line("pivot_get_on", "business_pivot", "Shall we get on?", 0, 3),

  // --- actually ending the call: only ever used when business is complete ---
  line("exit_enough_drive_safe", "call_exit", "That's enough from me. Drive safe.", 0, 3),
  line("exit_leave_you_to_it", "call_exit", "I'll leave you to it.", 0, 3),
  line("exit_off_you_go", "call_exit", "Right. That's me done. Off you go.", 0, 3),
];
