/**
 * Campaign archetypes choose the movie that binds today's real work.
 * They cannot invent objectives, deadlines, geography, or outcomes.
 */

import type { CampaignArchetypeId, CampaignChapterKind } from "./goldlineCampaign";
import type { GoldlineObjective } from "./goldlineAdventure";
import type { TerritoryCampaignHint } from "./goldlineCampaign";

export type CampaignArchetype = {
  id: CampaignArchetypeId;
  name: string;
  eligibility: string;
  premise: string;
  openingTreatment: string;
  transitionVocabulary: string;
  optionalBranchTreatment: string;
  setbackTreatment: string;
  climaxPreference: CampaignChapterKind;
  completionTreatment: string;
  arcPattern: string;
};

export const CAMPAIGN_ARCHETYPES: Record<CampaignArchetypeId, CampaignArchetype> = {
  broken_crown: {
    id: "broken_crown",
    name: "THE BROKEN CROWN",
    eligibility: "A fixed commitment plus at least one legitimate nearby opportunity or territory member.",
    premise: "A real delivery or pickup holds the day together while the Gold Line hunts unfinished doors.",
    openingTreatment: "The first hard anchor lights. The city names the crown.",
    transitionVocabulary: "The line tightens toward the next real stop.",
    optionalBranchTreatment: "A side street of legitimate recovery or prospect work, skippable without fake failure.",
    setbackTreatment: "The crown cracks; the real reason is whatever evidence recorded.",
    climaxPreference: "guardian_finale",
    completionTreatment: "CROWN RESTORED when the authored arc ends — not when every account is won.",
    arcPattern: "hard anchor → corridor → optional branch → territory/guardian if honestly ready",
  },
  golden_circuit: {
    id: "golden_circuit",
    name: "GOLDEN CIRCUIT",
    eligibility: "Pickup/delivery-heavy day with two or more fixed commitments.",
    premise: "The courier circuit is the campaign. Relics and Ruinbound decorate the ride, they do not invent stops.",
    openingTreatment: "The first parcel knot glows.",
    transitionVocabulary: "Next gate. Same city. Same real windows.",
    optionalBranchTreatment: "Only a genuine nearby opportunity that still fits the next window.",
    setbackTreatment: "A blocked pickup stays blocked; the circuit reroutes future only.",
    climaxPreference: "hard_anchor",
    completionTreatment: "ROUTE HELD — hard commitments complete; leftover opportunities remain tomorrow.",
    arcPattern: "pickup → delivery chain with geographic fill",
  },
  ghost_signal: {
    id: "ghost_signal",
    name: "GHOST SIGNAL",
    eligibility: "Recovery or follow-up work dominates; few or no fixed courier anchors.",
    premise: "A dormant lantern still knows this street. The campaign is listening, not inventing customers.",
    openingTreatment: "A faint signal at a real building.",
    transitionVocabulary: "The signal holds. No timer over the conversation.",
    optionalBranchTreatment: "A second legitimate follow-up if it is already due.",
    setbackTreatment: "No answer is no answer. The ghost remains until evidence says otherwise.",
    climaxPreference: "recovery_branch",
    completionTreatment: "THE SIGNAL CONTINUES if a real follow-up still hangs.",
    arcPattern: "recovery/follow-up spine with optional extra contact",
  },
  six_doors: {
    id: "six_doors",
    name: "SIX DOORS",
    eligibility: "A visit hunt / territory corridor of real unfinished members.",
    premise: "The street is the dungeon. Each door is a canonical physicalEntityId.",
    openingTreatment: "The veil names how many doors still sleep.",
    transitionVocabulary: "One aperture. Then the next real address.",
    optionalBranchTreatment: "A recovery branch only if it is already on the books.",
    setbackTreatment: "A closed building is a closed building.",
    climaxPreference: "guardian_finale",
    completionTreatment: "STORM BROKEN only after derived confrontation-ready and a game-projection defeat.",
    arcPattern: "visit hunt → territory push → guardian if ready",
  },
  last_window: {
    id: "last_window",
    name: "LAST WINDOW",
    eligibility: "Two or more real time-constrained commitments. No fabricated timer.",
    premise: "The day's windows are already true. The campaign sequences them honestly.",
    openingTreatment: "The earliest real window takes the stage.",
    transitionVocabulary: "The next window is named, never invented.",
    optionalBranchTreatment: "Flexible work only if it still fits before the next window.",
    setbackTreatment: "A missed window is a real missed window.",
    climaxPreference: "hard_anchor",
    completionTreatment: "ROUTE HELD when the last real window is honored or expired in truth.",
    arcPattern: "timed anchors with geographic fill between them",
  },
  open_sky: {
    id: "open_sky",
    name: "OPEN SKY",
    eligibility: "Low-constraint day: legitimate flexible opportunities without a courier spine.",
    premise: "The city is playable even when the day is light. No fake homework.",
    openingTreatment: "A quiet Gold Line over whatever is actually due.",
    transitionVocabulary: "Choose a real branch or roam.",
    optionalBranchTreatment: "Every remaining opportunity is optional.",
    setbackTreatment: "Skipping is not failure.",
    climaxPreference: "opportunity_corridor",
    completionTreatment: "OPEN SKY remains — the world stays fun at 10 PM with nothing required.",
    arcPattern: "optional corridors, quiet if empty",
  },
};

export function selectCampaignArchetype(input: {
  objectives: readonly GoldlineObjective[];
  territories?: readonly TerritoryCampaignHint[];
}): CampaignArchetypeId {
  const ready = input.objectives.filter(item => item.status === "ready");
  const fixed = ready.filter(item => item.authority === "fixed_commitment");
  const timed = fixed.filter(item => Boolean(item.windowStart));
  const recoveries = ready.filter(item => item.kind === "recovery" || item.kind === "follow_up");
  const visits = ready.filter(item => item.kind === "commercial_visit");
  const territoryOpen = (input.territories ?? []).some(item => !item.cleared);
  const courier = ready.filter(item => item.kind === "pickup" || item.kind === "delivery");

  if (timed.length >= 2) return "last_window";
  if (courier.length >= 2 && visits.length <= 1 && recoveries.length === 0) return "golden_circuit";
  if (territoryOpen && visits.length >= 2 && fixed.length === 0) return "six_doors";
  if (fixed.length >= 1 && (visits.length >= 1 || territoryOpen || recoveries.length >= 1)) return "broken_crown";
  if (recoveries.length >= 1 && fixed.length === 0) return "ghost_signal";
  if ((input.territories ?? []).some(item => item.confrontationReady && !item.cleared)) {
    return "six_doors";
  }
  return "open_sky";
}
