import { listAllAcceptedTeachings } from "../salesIntel/salesIntelTeachingStore";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";
import type { MissionSalesBriefIntelReference } from "../../shared/missionSalesBrief";

/**
 * Eligibility gate (Slice 4): "Is this intelligence allowed to influence
 * this mission brief?" Fails closed — anything not explicitly accepted and
 * active is excluded. `listAllAcceptedTeachings` already filters on
 * reviewState === "accepted" && active === true; this function is a second,
 * explicit line of defense so a change to that store function can't
 * silently widen what reaches a mission brief, and it is the single call
 * site the rest of this domain must go through.
 */
export async function listEligibleSalesIntel(): Promise<SalesIntelTeaching[]> {
  const teachings = await listAllAcceptedTeachings();
  return teachings.filter(
    teaching => teaching.reviewState === "accepted" && teaching.active
  );
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  opening: ["opening", "introduce", "first visit", "cold"],
  discovery: ["unknown", "why", "blocker", "stalled", "find out", "learn"],
  objection_handling: ["objection", "concern", "hesitant", "price", "cost"],
  follow_up: ["follow up", "follow-up", "reopen", "return visit"],
  positioning: ["positioning", "amenity", "value proposition"],
  closing: ["close", "sign", "commit", "approve"],
};

export type SalesIntelSelectionAudit = {
  selected: MissionSalesBriefIntelReference | null;
  considered: Array<{ id: string; reason: string }>;
  excluded: Array<{ id: string; reason: string }>;
};

/**
 * Relevance selection (Slice 5) + one-framework-maximum (Slice 7). Never
 * stacks multiple teachings — returns at most one, and only when a
 * category's keywords materially match the mission's situation text
 * (its unresolved questions / primary signal), never merely because
 * eligible intel exists. Returns null when nothing materially fits —
 * that is a valid, often-preferable answer.
 */
export function selectSalesIntelWithAudit(input: {
  eligible: SalesIntelTeaching[];
  situationText: string;
}): SalesIntelSelectionAudit {
  const haystack = input.situationText.toLowerCase();
  const considered: Array<{ id: string; reason: string }> = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  let best: { teaching: SalesIntelTeaching; score: number } | null = null;

  for (const teaching of input.eligible) {
    considered.push({ id: teaching.id, reason: `eligible ${teaching.category}` });
    const keywords = CATEGORY_KEYWORDS[teaching.category] ?? [];
    const matchCount = keywords.filter(keyword => haystack.includes(keyword)).length;
    if (matchCount === 0) {
      excluded.push({ id: teaching.id, reason: "no material category match" });
      continue;
    }
    const score = matchCount * 10 + (teaching.confidence ?? 0);
    if (!best || score > best.score) best = { teaching, score };
  }

  if (best) {
    for (const teaching of input.eligible) {
      if (teaching.id !== best.teaching.id && !excluded.some(entry => entry.id === teaching.id)) {
        excluded.push({ id: teaching.id, reason: "one teaching maximum" });
      }
    }
  }

  return {
    selected: best
      ? {
          teachingId: best.teaching.id,
          category: best.teaching.category,
          title: best.teaching.title,
          rationale: `Matched the mission's situation (category: ${best.teaching.category}).`,
          principle: best.teaching.principle,
          whenToUse: best.teaching.whenToUse,
          whenNotToUse: best.teaching.whenNotToUse,
          exampleLanguage: best.teaching.exampleLanguage.map(phrase => phrase.text),
        }
      : null,
    considered,
    excluded,
  };
}

export function selectRelevantSalesIntel(input: {
  eligible: SalesIntelTeaching[];
  situationText: string;
}): MissionSalesBriefIntelReference | null {
  return selectSalesIntelWithAudit(input).selected;
}
