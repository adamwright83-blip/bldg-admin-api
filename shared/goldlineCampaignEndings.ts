/**
 * Campaign completion is a game-arc end state. It does not mean the
 * business was won.
 */

import type { CampaignDraft, TerritoryCampaignHint } from "./goldlineCampaign";

export type CampaignEndingId =
  | "crown_restored"
  | "signal_continues"
  | "route_held"
  | "storm_broken"
  | "open_sky";

export function campaignEndingTreatment(input: {
  draft: Pick<CampaignDraft, "campaignArchetypeId" | "chapters" | "completedChapterIds" | "status">;
  territories?: readonly TerritoryCampaignHint[];
  unresolvedFollowUp: boolean;
}): { id: CampaignEndingId; copy: string } {
  const guardianCleared = (input.territories ?? []).some(item => item.cleared);
  const remainingRequired = input.draft.chapters.filter(
    chapter => chapter.required && !input.draft.completedChapterIds.includes(chapter.stableChapterId)
  );
  if (guardianCleared && remainingRequired.length === 0) {
    return {
      id: "storm_broken",
      copy: "STORM BROKEN — the Guardian fell in the game. The buildings are still whatever they are.",
    };
  }
  if (input.unresolvedFollowUp) {
    return {
      id: "signal_continues",
      copy: "THE SIGNAL CONTINUES — a real follow-up remains. Tomorrow can pick it up.",
    };
  }
  if (input.draft.campaignArchetypeId === "golden_circuit" || input.draft.campaignArchetypeId === "last_window") {
    return {
      id: "route_held",
      copy: "ROUTE HELD — the hard commitments of the authored day are done. Leftover opportunities remain themselves.",
    };
  }
  if (input.draft.campaignArchetypeId === "open_sky" || input.draft.status === "quiet") {
    return {
      id: "open_sky",
      copy: "OPEN SKY — the city stays playable with nothing required.",
    };
  }
  return {
    id: "crown_restored",
    copy: "CROWN RESTORED — this adventure ended. Unresolved reality is still unresolved.",
  };
}
