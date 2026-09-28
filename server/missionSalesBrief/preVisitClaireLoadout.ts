import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";
import type {
  ClairePreVisitLoadout,
  ClairePreVisitLoadoutItem,
  MissionSalesBrief,
} from "../../shared/missionSalesBrief";
import { ensureCurrentMissionSalesBrief } from "./missionSalesBriefService";
import { listEligibleSalesIntel } from "./salesIntelEligibility";

const SLOT_ORDER = ["OPEN", "PROBE", "WEAPON"] as const;
type Slot = (typeof SLOT_ORDER)[number];

const SLOT_CATEGORIES: Record<Slot, readonly string[]> = {
  OPEN: ["opening", "prospecting", "rapport", "positioning"],
  PROBE: ["discovery", "questioning", "qualification"],
  WEAPON: [
    "objection_prevention",
    "objection_handling",
    "value",
    "positioning",
    "closing",
  ],
};

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "another", "because", "before", "being",
  "building", "could", "from", "have", "here", "into", "just", "more", "most",
  "only", "other", "should", "that", "their", "there", "these", "they", "this",
  "through", "under", "very", "what", "when", "where", "which", "while", "with",
  "would", "your",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(token => token.length >= 4 && !STOP_WORDS.has(token))
  );
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function missionSituationText(brief: MissionSalesBrief): string {
  const accountAliases =
    /multifamily|apartment/i.test(brief.account.accountType ?? "")
      ? "multifamily apartment apartments resident residents property amenity manager"
      : /hotel/i.test(brief.account.accountType ?? "")
        ? "hotel guest guests property hospitality manager"
        : brief.account.accountType ?? "";

  return [
    brief.account.name,
    brief.account.accountType ?? "",
    accountAliases,
    brief.mission.missionType,
    brief.mission.currentStatus,
    brief.mission.objective,
    brief.recommendedApproach.primaryObjective,
    brief.recommendedApproach.recommendedOpening ?? "",
    ...brief.recommendedApproach.questionsToAsk,
    ...brief.recommendedApproach.actionsToTake,
    ...brief.recommendedApproach.thingsToAvoid,
    ...brief.knownFacts.map(fact => fact.text),
    ...brief.priorInteractions.map(item => item.summary),
    ...brief.priorOutcomes.map(item => item.outcome),
    ...brief.relevantSignals.map(item => item.summary),
    ...brief.unknowns.map(item => item.question),
    ...brief.unresolvedQuestions,
  ].join(" ");
}

function teachingRelevanceScore(
  teaching: SalesIntelTeaching,
  brief: MissionSalesBrief
): number | null {
  if (teaching.id === brief.salesIntel.teachingId) return 200;

  const situation = tokens(missionSituationText(brief));
  const negativeMatches = teaching.whenNotToUse
    .map(condition => overlap(tokens(condition), situation))
    .filter(score => score > 0);
  if (negativeMatches.some(score => score >= 2)) return null;

  const whenScore = Math.max(
    0,
    ...teaching.whenToUse.map(condition => overlap(tokens(condition), situation))
  );
  const contentScore = Math.max(
    overlap(tokens(teaching.title), situation),
    overlap(tokens(teaching.principle), situation),
    ...teaching.exampleLanguage.map(phrase =>
      overlap(tokens(phrase.text), situation)
    )
  );

  /*
   * A teaching needs a material tie to this mission. Category compatibility
   * alone is not enough: a generic accepted lesson does not become relevant
   * to every building just because it is an "opening" or "closing" lesson.
   */
  if (whenScore === 0 && contentScore === 0) return null;

  return whenScore * 30 + contentScore * 10;
}

function byConfidenceThenRecency(
  left: SalesIntelTeaching,
  right: SalesIntelTeaching
) {
  const confidenceDelta = (right.confidence ?? 0) - (left.confidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  return (
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

type Candidate = {
  teaching: SalesIntelTeaching;
  score: number;
};

function candidatesForSlot(
  slot: Slot,
  teachings: SalesIntelTeaching[],
  brief: MissionSalesBrief
): Candidate[] {
  return teachings
    .filter(
      teaching =>
        teaching.reviewState === "accepted" &&
        teaching.active &&
        SLOT_CATEGORIES[slot].includes(teaching.category)
    )
    .map(teaching => ({
      teaching,
      score: teachingRelevanceScore(teaching, brief),
    }))
    .filter((item): item is { teaching: SalesIntelTeaching; score: number } =>
      item.score !== null
    )
    .sort((left, right) => {
      // Shelby is the preferred authored trainer only after mission relevance
      // and slot compatibility have both been established.
      const leftShelby = /\bshelby\s+sapp\b/i.test(left.teaching.creatorName);
      const rightShelby = /\bshelby\s+sapp\b/i.test(right.teaching.creatorName);
      if (leftShelby !== rightShelby) return leftShelby ? -1 : 1;
      if (left.score !== right.score) return right.score - left.score;
      return byConfidenceThenRecency(left.teaching, right.teaching);
    })
    .slice(0, 8);
}

/**
 * Choose all three slots as one loadout rather than greedily consuming a
 * multi-role teaching in OPEN and starving WEAPON. Filled slots dominate the
 * score; within equally complete loadouts, mission relevance, Shelby
 * preference, confidence, and recency break ties.
 */
export function selectClairePreVisitTeachings(
  teachings: SalesIntelTeaching[],
  brief: MissionSalesBrief
): Array<{ slot: Slot; teaching: SalesIntelTeaching | null }> {
  const bySlot = new Map(
    SLOT_ORDER.map(slot => [slot, candidatesForSlot(slot, teachings, brief)])
  );

  let best: {
    score: number;
    picks: Array<{ slot: Slot; teaching: SalesIntelTeaching | null }>;
  } | null = null;

  function walk(
    slotIndex: number,
    used: Set<string>,
    picks: Array<{ slot: Slot; teaching: SalesIntelTeaching | null }>,
    score: number
  ) {
    if (slotIndex === SLOT_ORDER.length) {
      if (!best || score > best.score) best = { score, picks: [...picks] };
      return;
    }
    const slot = SLOT_ORDER[slotIndex];

    // Null is always legal: MissionSalesBrief is the truthful fallback.
    walk(
      slotIndex + 1,
      used,
      [...picks, { slot, teaching: null }],
      score
    );

    for (const candidate of bySlot.get(slot) ?? []) {
      if (used.has(candidate.teaching.id)) continue;
      const nextUsed = new Set(used);
      nextUsed.add(candidate.teaching.id);
      const shelbyBonus = /\bshelby\s+sapp\b/i.test(
        candidate.teaching.creatorName
      )
        ? 20
        : 0;
      const confidenceBonus = Math.round(
        (candidate.teaching.confidence ?? 0) * 10
      );
      walk(
        slotIndex + 1,
        nextUsed,
        [...picks, { slot, teaching: candidate.teaching }],
        score + 1000 + candidate.score + shelbyBonus + confidenceBonus
      );
    }
  }

  walk(0, new Set(), [], 0);
  return (
    best?.picks ??
    SLOT_ORDER.map(slot => ({ slot, teaching: null }))
  );
}

function sourceLine(teaching: SalesIntelTeaching | null): string | null {
  if (!teaching) return null;
  const exact = teaching.exampleLanguage.find(
    item => item.kind === "exact_source_phrase"
  );
  const any = teaching.exampleLanguage[0];
  const line =
    (exact ?? any)?.text?.trim() ||
    teaching.principle.trim() ||
    null;

  // Do not mutate reviewed doctrine into an unreviewed fragment. If the
  // reviewed language is too long for this quick-equipment surface, Claire
  // falls back to the already-compiled MissionSalesBrief slot.
  return line && line.length <= 220 ? line : null;
}

function missionBriefLine(brief: MissionSalesBrief, slot: Slot): string {
  if (slot === "OPEN") {
    return (
      brief.recommendedApproach.recommendedOpening?.trim() ||
      "Lead with one clear reason for the visit, then let them respond."
    );
  }
  if (slot === "PROBE") {
    return (
      brief.recommendedApproach.questionsToAsk[0]?.trim() ||
      brief.unknowns[0]?.question ||
      "Ask one question that reveals the real blocker before pitching harder."
    );
  }
  return (
    brief.recommendedApproach.thingsToAvoid[0]?.trim() ||
    "Do not manufacture urgency. Find the real friction and respond to that."
  );
}

/**
 * No second generative truth layer here.
 *
 * The MissionSalesBrief is already the existing building-specific compiler
 * with its own unsupported-fact guard. Reviewed trainer lines cross this
 * boundary byte-for-byte from accepted Sales Intel. That makes the three
 * equips useful without asking another model to invent a bespoke sentence.
 */
export function compileClairePreVisitItems(input: {
  brief: MissionSalesBrief;
  selected: Array<{ slot: Slot; teaching: SalesIntelTeaching | null }>;
}): ClairePreVisitLoadoutItem[] {
  return input.selected.map(({ slot, teaching }) => {
    const trainerLine = sourceLine(teaching);
    if (teaching && trainerLine) {
      return {
        slot,
        line: trainerLine,
        sourceTeachingId: teaching.id,
        sourceCreator: teaching.creatorName,
        sourceTitle: teaching.title,
        provenance: "reviewed_sales_intel" as const,
      };
    }

    return {
      slot,
      line: missionBriefLine(input.brief, slot),
      sourceTeachingId: null,
      sourceCreator: null,
      sourceTitle: null,
      provenance: "mission_brief" as const,
    };
  });
}

export async function getClairePreVisitLoadout(input: {
  tenantId: string;
  missionId: number;
}): Promise<ClairePreVisitLoadout | null> {
  const brief = await ensureCurrentMissionSalesBrief(input);
  if (!brief) return null;

  const selected = selectClairePreVisitTeachings(
    await listEligibleSalesIntel(),
    brief
  );

  return {
    missionId: brief.missionId,
    briefId: brief.id,
    briefVersion: brief.version,
    buildingName: brief.account.name,
    buildingAddress: brief.account.address,
    generatedAt: new Date().toISOString(),
    items: compileClairePreVisitItems({ brief, selected }),
  };
}
