/**
 * Claire Intelligence Repair Part 2, Slice E — prompt diet.
 *
 * Slice A's empty-context follow-up prompt was 13,314 characters. The
 * program target is ≤2,500 characters of *static* instruction: everything
 * that does not grow with the operator's canon, few-shot voice, or today's
 * fact inventory. Dynamic blocks are measured live by Slice A telemetry.
 */

export const CLAIRE_STATIC_INSTRUCTION_BUDGET = 2_500;

export const CLAIRE_DYNAMIC_PROMPT_LABELS = new Set([
  "compiled_canon",
  "few_shot_voice",
  "fact_inventory",
]);

export function claireStaticInstructionChars(
  sections: Array<{ label: string; chars?: number; text?: string | null | undefined }>
): number {
  return sections.reduce((sum, section) => {
    if (CLAIRE_DYNAMIC_PROMPT_LABELS.has(section.label)) return sum;
    const chars = section.chars ?? section.text?.length ?? 0;
    return sum + chars;
  }, 0);
}
