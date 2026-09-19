import { AUTHORED_DIALOGUE, type DialogueCategory, type DialogueLine } from "./authoredDialogue";

/**
 * Selection over the operator-authored registry: eligibility (category +
 * rapport window), rapport-aware preference, and non-repetition.
 * This file contains no Claire dialogue of its own.
 */

/** The always-available floor: approved generic declines. Never empty in production. */
export function genericDeclineFloor(registry: readonly DialogueLine[] = AUTHORED_DIALOGUE): DialogueLine[] {
  return registry.filter(line => line.category === "decline" && line.minRapport === 0 && line.maxRapport === 3);
}

export type SelectDialogueInput = {
  category: DialogueCategory;
  rapportBand: 0 | 1 | 2 | 3;
  /** Line ids used recently in this operator's history, most recent last. */
  recentlyUsedIds?: readonly string[];
  registry?: readonly DialogueLine[];
  /** Deterministic in tests; Math.random in production. */
  random?: () => number;
  /**
   * When the category has no authored lines, whether to fall back to the generic
   * decline floor. True for decline-shaped categories; false for behaviors that
   * must stay dormant without an authored line (call_exit, business_pivot).
   */
  fallbackToDeclineFloor?: boolean;
};

const DECLINE_SHAPED: ReadonlySet<DialogueCategory> = new Set([
  "decline",
  "thread_closer",
  "boundary_reinforcement",
  "recovery_after_failed_generation",
]);

export function selectDialogueLine(input: SelectDialogueInput): DialogueLine | null {
  const registry = input.registry ?? AUTHORED_DIALOGUE;
  const random = input.random ?? Math.random;
  const inWindow = (line: DialogueLine) =>
    input.rapportBand >= line.minRapport && input.rapportBand <= line.maxRapport;

  let pool = registry.filter(line => line.category === input.category && inWindow(line));
  const allowFallback = input.fallbackToDeclineFloor ?? DECLINE_SHAPED.has(input.category);
  if (!pool.length && allowFallback) {
    pool = registry.filter(line => line.category === "decline" && inWindow(line));
  }
  if (!pool.length) return null;

  // Rapport-aware: prefer the lines whose window is narrowest around this band
  // (i.e. authored for this band) over broad generic ones.
  const specificity = (line: DialogueLine) => line.maxRapport - line.minRapport;
  const narrowest = Math.min(...pool.map(specificity));
  pool = pool.filter(line => specificity(line) === narrowest);

  // Non-repetition: drop the most recently used lines while others remain.
  const recent = input.recentlyUsedIds ?? [];
  const fresh = pool.filter(line => !recent.includes(line.id));
  if (fresh.length) return fresh[Math.floor(random() * fresh.length) % fresh.length];
  // All used recently: choose the least recently used.
  const lastUse = (line: DialogueLine) => recent.lastIndexOf(line.id);
  return [...pool].sort((a, b) => lastUse(a) - lastUse(b))[0];
}
