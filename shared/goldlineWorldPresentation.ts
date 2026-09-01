/**
 * How the projected world state is allowed to look.
 *
 * `goldlineWorld.ts` decides what is true about a physical entity. This module
 * decides only how the world may express that truth, and it is deliberately
 * pure so the same answer is available to the atlas, the overworld and tests.
 *
 * Three rules hold everything here together:
 *
 *  1. Presentation never invents a fact. Every visible mark and every unit of
 *     prominence traces back to an event that already exists in the projection.
 *  2. Uncertainty is about knowledge, never about geography. A veil describes
 *     what Goldline does or does not know; it never moves, renames or hides the
 *     physical place, which stays exactly where the real coordinate put it.
 *  3. Nothing here resolves uncertainty. Looking, refreshing and waiting all
 *     produce the identical output for identical input — only new evidence
 *     reaching the projection can change the veil.
 */

import type {
  AttentionReason,
  EpistemicState,
  ProjectedPhysicalWorldState,
  WorldHistoryMark,
} from "./goldlineWorld";

/**
 * The environmental treatment for an epistemic state.
 *
 * These are perceptual layers over an already-recognised building, not
 * different buildings: `haze` is the sun-bleached veil over a place whose
 * significance has not been established, `fracture` is the instability of two
 * sources disagreeing, `tracing` is the translucent line-work of something
 * inferred rather than observed, and `pressure` is weather — atmosphere moving
 * over a place because a forecast, not a fact, is pushing on it.
 */
export type EpistemicVeil = "none" | "haze" | "fracture" | "tracing" | "pressure";

export type WorldMarkPresentation = {
  semantic: WorldHistoryMark;
  /** How many real events produced this mark. Never inflated past the events. */
  count: number;
  latestAt: string;
  explanation: string;
  sourceEvidenceReference: string;
};

export type WorldPresentation = {
  physicalEntityId: string;
  veil: EpistemicVeil;
  /**
   * The non-visual equivalent of the veil. Every uncertainty state must be
   * answerable without seeing the atmosphere, so this string is what screen
   * readers and inspector copy both use.
   */
  veilExplanation: string;
  /** Deduplicated history, newest first, capped for legibility not for truth. */
  marks: WorldMarkPresentation[];
  /** Real marks beyond `marks`, so a trimmed list never reads as the whole history. */
  additionalMarkCount: number;
  /**
   * 0..1, taken from the strongest single attention reason rather than a sum,
   * so a place cannot become loud merely by accumulating weak signals.
   */
  prominence: number;
  prominenceTier: "ambient" | "noticed" | "urgent";
  /** Why the world is emphasising this place, in the words of the reason itself. */
  attentionSummary: string | null;
  /** Warm inhabited light, straight from the projection's own illumination. */
  illumination: ProjectedPhysicalWorldState["illumination"];
  residentIntensity: number;
  /** True only where a real approved asset exists to embody the place. */
  hasPublishedEmbodiment: boolean;
};

const VEIL_BY_STATE: Record<EpistemicState, EpistemicVeil> = {
  confirmed: "none",
  conflicting: "fracture",
  unknown: "haze",
  inferred: "tracing",
  forecast_pressure: "pressure",
  game_fiction: "none",
};

const VEIL_EXPLANATIONS: Record<EpistemicState, string> = {
  confirmed:
    "Confirmed by authoritative evidence. This place is what Goldline says it is.",
  conflicting:
    "Sources disagree about this place. Goldline is showing the disagreement rather than picking a winner; only resolving the evidence settles it.",
  unknown:
    "Goldline can see this place but has not established its significance. The building is real; the knowledge is missing. Viewing it does not reveal it.",
  inferred:
    "Traced from related records rather than observed directly. Treat it as a lead, not a fact.",
  forecast_pressure:
    "No new fact here — a forecast derived from real history is pushing on this place. Pressure is not a deadline.",
  game_fiction:
    "Generated game representation. It carries no business claim.",
};

const MARK_LABELS: Record<WorldHistoryMark, string> = {
  discovered: "discovered",
  visited: "visited",
  contacted: "contacted",
  proposal_sent: "proposal delivered",
  lost: "account lost",
  won: "relationship won",
  customer_activity: "resident activity",
  recovery: "recovered",
};

/** Newest marks first, so the most recent history is the history you see. */
const MARK_LIMIT = 6;

function summarizeAttention(reasons: AttentionReason[]): string | null {
  const strongest = reasons[0];
  if (!strongest) return null;
  if (reasons.length === 1) return strongest.explanation;
  return `${strongest.explanation} (+${reasons.length - 1} more reason${reasons.length === 2 ? "" : "s"})`;
}

/**
 * Collapses repeated marks of the same kind into one presentable mark carrying
 * its real count, because a building that was visited nine times should read as
 * heavily visited without drawing nine identical scars.
 */
function presentMarks(projection: ProjectedPhysicalWorldState) {
  const bySemantic = new Map<WorldHistoryMark, WorldMarkPresentation>();
  for (const mark of projection.historyMarks) {
    const existing = bySemantic.get(mark.semantic);
    if (!existing) {
      bySemantic.set(mark.semantic, {
        semantic: mark.semantic,
        count: 1,
        latestAt: mark.occurredAt,
        explanation: mark.explanation,
        sourceEvidenceReference: mark.sourceEvidenceReference,
      });
      continue;
    }
    existing.count += 1;
    if (Date.parse(mark.occurredAt) >= Date.parse(existing.latestAt)) {
      existing.latestAt = mark.occurredAt;
      existing.explanation = mark.explanation;
      existing.sourceEvidenceReference = mark.sourceEvidenceReference;
    }
  }
  const ordered = Array.from(bySemantic.values()).sort(
    (a, b) =>
      Date.parse(b.latestAt) - Date.parse(a.latestAt) ||
      a.semantic.localeCompare(b.semantic)
  );
  return {
    marks: ordered.slice(0, MARK_LIMIT),
    additionalMarkCount: Math.max(0, ordered.length - MARK_LIMIT),
  };
}

export function presentWorldState(
  projection: ProjectedPhysicalWorldState
): WorldPresentation {
  const prominence = projection.attentionReasons.reduce(
    (highest, reason) => Math.max(highest, reason.weight),
    0
  );
  const { marks, additionalMarkCount } = presentMarks(projection);
  return {
    physicalEntityId: projection.physicalEntityId,
    veil: VEIL_BY_STATE[projection.epistemicState],
    veilExplanation: VEIL_EXPLANATIONS[projection.epistemicState],
    marks,
    additionalMarkCount,
    prominence,
    prominenceTier:
      prominence >= 0.8 ? "urgent" : prominence >= 0.5 ? "noticed" : "ambient",
    attentionSummary: summarizeAttention(projection.attentionReasons),
    illumination: projection.illumination,
    residentIntensity: projection.residentIntensity,
    hasPublishedEmbodiment: projection.canonicalTowerAssetId !== null,
  };
}

/**
 * The full spoken description of a place: identity, then knowledge, then
 * history, then why it is being emphasised. Anything the atmosphere says
 * visually has to be sayable here too, or the uncertainty is inaccessible.
 */
export function describeWorldPresentation(
  name: string,
  presentation: WorldPresentation
): string {
  const parts = [name, presentation.veilExplanation];
  if (presentation.marks.length) {
    parts.push(
      `History: ${presentation.marks
        .map(mark =>
          mark.count > 1
            ? `${MARK_LABELS[mark.semantic]} ${mark.count} times`
            : MARK_LABELS[mark.semantic]
        )
        .join(", ")}.`
    );
  }
  if (presentation.attentionSummary) {
    parts.push(`Goldline is drawing attention here: ${presentation.attentionSummary}.`);
  }
  return parts.join(" ");
}

/**
 * Ordering for the city: the places Goldline most wants looked at come first.
 * Prominence only ever reorders and emphasises. It never edits pipeline stage,
 * revenue, geography or any other fact about the places it is ranking.
 */
export function orderByProminence<T>(
  items: T[],
  presentationOf: (item: T) => WorldPresentation | null
): T[] {
  return [...items].sort((a, b) => {
    const left = presentationOf(a);
    const right = presentationOf(b);
    return (right?.prominence ?? 0) - (left?.prominence ?? 0);
  });
}
