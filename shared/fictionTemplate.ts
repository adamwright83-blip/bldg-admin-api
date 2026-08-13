/**
 * Fiction Template contract — Layer 3 of the mission-fiction architecture.
 * Answers "what entertaining scenario can make this exact physical action
 * feel like a game?" A template chooses STORY. It structurally cannot
 * choose the underlying business action: nothing in `FictionTemplate` can
 * create, size, or relocate an `ActionGrammar` — every field here is either
 * presentation (title/briefing/instruction formatter/stakes/treatments) or
 * an eligibility/safety predicate over a grammar that already exists.
 *
 * Determinism: selection never uses `Math.random()` or the current
 * wall-clock date as a seed. See `deriveFictionAssignment` — it hashes a
 * caller-supplied stable identity string and indexes into a canonically
 * (by id) sorted eligible list, so the same identity always produces the
 * same template regardless of when it's evaluated or in what order
 * templates were registered.
 */
import type { ActionGrammar, ActionGrammarKind } from "./actionGrammar";

export const FICTION_RULES_VERSION = 1 as const;

export const FICTION_ATTENTION_SAFETY_CLASSES = [
  "safe_stationary",
  "safe_walking",
  "unsafe_while_driving",
] as const;
export type FictionAttentionSafetyClass =
  (typeof FICTION_ATTENTION_SAFETY_CLASSES)[number];

/**
 * Presentation-only treatment of a fictional outcome. Deliberately has no
 * field that could be mistaken for a business-truth mutation — see
 * shared/twoClockOutcome.ts for the structural separation.
 */
export type FictionOutcomeTreatment = {
  headline: string;
  detail: string;
};

export type FictionTemplate = {
  id: string;
  rulesVersion: number;
  compatibleGrammarKinds: readonly ActionGrammarKind[];
  title: string;
  /** Pure function: grammar (real data) -> fictional briefing copy. */
  briefing: (grammar: ActionGrammar) => string;
  /**
   * Pure function producing the operationally-unambiguous physical
   * instruction. Literal real-world nouns (what to carry, where to go) are
   * expected here — see the Fiction Integrity Copy Gate in
   * docs/goldline-fiction-authoring.md.
   */
  physicalInstruction: (grammar: ActionGrammar) => string;
  stakes: string;
  successTreatment: FictionOutcomeTreatment;
  failureTreatment: FictionOutcomeTreatment;
  worldReturnTreatment: string;
  timerEligible: boolean;
  drivingCompatible: boolean;
  attentionSafetyClass: FictionAttentionSafetyClass;
  /** True when the template is compatible with a real human conversation (e.g. a call). */
  humanInteractionCompatible: boolean;
};

/**
 * A template is eligible for a grammar only when its declared compatible
 * kinds include the grammar's kind AND its safety declarations do not
 * conflict with what the grammar says is actually happening physically.
 */
export function isTemplateEligible(
  template: FictionTemplate,
  grammar: ActionGrammar
): boolean {
  if (!template.compatibleGrammarKinds.includes(grammar.kind)) return false;
  // An attention-demanding countdown must never bind to a driving action.
  if (
    template.timerEligible &&
    grammar.requiresDriving &&
    !template.drivingCompatible
  ) {
    return false;
  }
  // A sensitive real conversation (a call, a real follow-up) must never be
  // dramatized by a template that isn't declared compatible with one.
  if (grammar.sensitiveConversation && !template.humanInteractionCompatible) {
    return false;
  }
  // The grammar itself may already rule out a timer (e.g. a phone call);
  // a template cannot override that by simply wanting one.
  if (template.timerEligible && !grammar.timerSafe) return false;
  return true;
}

export function eligibleTemplates(
  registry: readonly FictionTemplate[],
  grammar: ActionGrammar
): FictionTemplate[] {
  return registry
    .filter(template => isTemplateEligible(template, grammar))
    // Canonical order: sorted by id. This is what makes hash-based selection
    // stable under registry reordering/additions — adding a new template
    // later changes the LENGTH of this list but never the relative order of
    // the templates that were already eligible before it existed... except
    // for the one case that genuinely should change: see
    // deriveFictionAssignment's persistence-first contract, which is the
    // real guard against that.
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * FNV-1a — a small, dependency-free, fully deterministic string hash. Never
 * a source of real randomness; the same input always produces the same
 * output on every platform.
 */
function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type FictionAssignment = {
  templateId: string;
  rulesVersion: number;
};

/**
 * Pure, deterministic derivation from a stable identity string. Never reads
 * `Date.now()`, `Math.random()`, or any other non-deterministic source.
 *
 * Returns null when nothing is eligible — the caller (Fiction Director)
 * must then present the real action without a genre episode rather than
 * force one.
 */
export function deriveFictionAssignment(
  stableMissionKey: string,
  registry: readonly FictionTemplate[],
  grammar: ActionGrammar
): FictionAssignment | null {
  const eligible = eligibleTemplates(registry, grammar);
  if (!eligible.length) return null;
  const index = stableHash(stableMissionKey) % eligible.length;
  const chosen = eligible[index]!;
  return { templateId: chosen.id, rulesVersion: chosen.rulesVersion };
}

/**
 * Builds the identity string `deriveFictionAssignment` hashes. Deliberately
 * excludes anything that changes without the underlying business action
 * itself changing (current time, route order, UI state) — those must never
 * cause the same unresolved action to become a different movie.
 */
export function stableMissionKey(input: {
  businessActionId: string | null;
  occurrenceId: number | null;
  grammarKind: ActionGrammarKind;
  fictionRulesVersion: number;
}): string {
  return [
    input.businessActionId ?? "none",
    input.occurrenceId ?? "none",
    input.grammarKind,
    input.fictionRulesVersion,
  ].join("::");
}
