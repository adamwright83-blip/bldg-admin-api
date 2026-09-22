/**
 * loadWeeklyDossier — read-only picture of the remaining week.
 * Recurrence is returned as rules. This module must not project Day Director rows.
 */

import type { WeeklyGrowthCandidate } from "../../../shared/weeklyGrowthCandidates";
import {
  emptyDraft,
  weekdayName,
  type RemainingWeekHorizon,
  type WeeklyDossierFact,
  type WeeklyDraft,
  type WeeklyFixedConstraint,
  type WeeklyInternalHypothesis,
  type WeeklyProvenance,
} from "../../../shared/weeklyMissionReadiness";

export type WeeklyDossier = {
  horizon: RemainingWeekHorizon;
  facts: WeeklyDossierFact[];
  fixedConstraints: WeeklyFixedConstraint[];
  /**
   * Canonical items from shared/weeklyGrowthCandidates.ts, loaded through
   * loadWeeklyGrowthCandidates. Private planning input. Not a weekday and not a primary.
   */
  growthCandidates?: readonly WeeklyGrowthCandidate[];
  writesBusinessTruth: false;
};

export type WeeklyDossierReaders = {
  factsForDates: (dates: readonly string[]) => Promise<WeeklyDossierFact[]>;
  growthCandidates?: () => Promise<readonly WeeklyGrowthCandidate[]>;
};

export async function loadWeeklyDossier(
  input: { horizon: RemainingWeekHorizon },
  readers: WeeklyDossierReaders
): Promise<WeeklyDossier> {
  const facts = bindRecurrenceToRemainingDays(
    await readers.factsForDates(input.horizon.remainingDates),
    input.horizon
  );
  const fixedConstraints = facts
    .filter((fact): fact is WeeklyDossierFact & { businessDate: string; scheduleLabel: string } => {
      if (!fact.businessDate || !fact.scheduleLabel) return false;
      return input.horizon.remainingDates.includes(fact.businessDate);
    })
    .map(fact => ({
      sourceRef: fact.id,
      title: fact.title,
      businessDate: fact.businessDate,
      scheduleLabel: fact.scheduleLabel,
    }));
  const growthCandidates = readers.growthCandidates ? await readers.growthCandidates() : undefined;
  return {
    horizon: input.horizon,
    facts,
    fixedConstraints,
    ...(growthCandidates ? { growthCandidates } : {}),
    writesBusinessTruth: false,
  };
}

export function draftFromDossier(dossier: WeeklyDossier): WeeklyDraft {
  return emptyDraft(dossier.horizon, dossier.fixedConstraints);
}

/**
 * Provisional week shape from the dossier alone.
 * Known windows stay known. Days without a mission stay unresolved.
 * Nothing here is a primary, a lock, or a visible week.
 */
export function deriveInternalHypothesis(dossier: WeeklyDossier): WeeklyInternalHypothesis {
  const known = dossier.facts.filter(fact => fact.businessDate && (fact.scheduleLabel || fact.title));
  let summary = known.length
    ? `Known so far: ${known
        .map(fact => `${fact.businessDate} ${fact.title}${fact.scheduleLabel ? ` ${fact.scheduleLabel}` : ""}`)
        .join("; ")}. Primaries are not decided.`
    : "The dossier does not yet support a week. Primaries are not decided.";
  const uncertainties: WeeklyInternalHypothesis["uncertainties"] = dossier.horizon.remainingDates.map(businessDate => {
    const dayFacts = known.filter(fact => fact.businessDate === businessDate);
    const around = dayFacts.map(fact => fact.title).join(", ");
    return {
      id: `gap:${businessDate}`,
      text: around
        ? `${weekdayName(businessDate)} still has no mission around ${around}`
        : `${weekdayName(businessDate)} has no grounded mission yet`,
      businessDate,
      status: "open" as const,
      sourceRefs: dayFacts.map(fact => fact.id),
    };
  });
  const options = dossier.growthCandidates ?? [];
  if (options.length) {
    const titles = options.map(candidate => candidate.title).join(", ");
    summary = `${summary} Unconfirmed growth options: ${titles}. They are not primaries.`;
    uncertainties.push({
      id: "growth-options",
      text: `Unconfirmed options remain: ${titles}`,
      businessDate: null,
      status: "open",
      sourceRefs: options.flatMap(candidate => [candidate.id, ...candidate.sourceRefs.map(ref => ref.sourceId)]),
    });
  }
  return { summary, uncertainties };
}

/**
 * An active weekday rule informs that remaining day as a snapshot.
 * The undated rule stays on the dossier. No Day Director row is created.
 */
export function bindRecurrenceToRemainingDays(
  facts: readonly WeeklyDossierFact[],
  horizon: RemainingWeekHorizon
): WeeklyDossierFact[] {
  const bound: WeeklyDossierFact[] = [];
  for (const fact of facts) {
    if (fact.class !== "recurrence_rule" || fact.businessDate || !fact.weekday) continue;
    for (const businessDate of horizon.remainingDates) {
      if (weekdayName(businessDate) !== fact.weekday) continue;
      bound.push({
        ...fact,
        id: `${fact.id}:${businessDate}`,
        businessDate,
      });
    }
  }
  return [...facts, ...bound];
}

export function provenance(input: WeeklyProvenance): WeeklyProvenance {
  return input;
}
