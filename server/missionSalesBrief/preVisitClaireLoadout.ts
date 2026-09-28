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

/**
 * Claire prefers Shelby only inside the role the teaching actually supports.
 * A closing lesson never becomes an OPEN merely because Shelby taught it.
 */
export function selectClairePreVisitTeachings(
  teachings: SalesIntelTeaching[]
): Array<{ slot: Slot; teaching: SalesIntelTeaching | null }> {
  const accepted = teachings
    .filter(teaching => teaching.reviewState === "accepted" && teaching.active)
    .sort(byConfidenceThenRecency);
  const used = new Set<string>();

  return SLOT_ORDER.map(slot => {
    const compatible = accepted.filter(
      teaching =>
        !used.has(teaching.id) &&
        SLOT_CATEGORIES[slot].includes(teaching.category)
    );
    const teaching =
      compatible.find(teaching =>
        /\bshelby\s+sapp\b/i.test(teaching.creatorName)
      ) ??
      compatible[0] ??
      null;
    if (teaching) used.add(teaching.id);
    return { slot, teaching };
  });
}

function sourceLine(teaching: SalesIntelTeaching | null): string | null {
  if (!teaching) return null;
  const exact = teaching.exampleLanguage.find(
    item => item.kind === "exact_source_phrase"
  );
  const any = teaching.exampleLanguage[0];
  return (
    (exact ?? any)?.text?.trim() ||
    teaching.principle.trim() ||
    null
  );
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
        line: trainerLine.slice(0, 220),
        sourceTeachingId: teaching.id,
        sourceCreator: teaching.creatorName,
        sourceTitle: teaching.title,
        provenance: "reviewed_sales_intel" as const,
      };
    }

    return {
      slot,
      line: missionBriefLine(input.brief, slot).slice(0, 220),
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
    await listEligibleSalesIntel()
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
