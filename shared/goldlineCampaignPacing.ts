/**
 * Campaign pacing changes fiction density only. It cannot invent work,
 * move a real deadline, or alter customer truth.
 */

import type { CampaignDraft, CampaignPacing } from "./goldlineCampaign";

export function campaignPacingFor(draft: Pick<CampaignDraft, "status" | "chapters" | "currentChapterId">): CampaignPacing {
  if (draft.status === "quiet" || draft.chapters.length === 0) return "quiet";
  const current = draft.chapters.find(chapter => chapter.stableChapterId === draft.currentChapterId);
  if (current?.campaignPhase === "climax" || current?.chapterKind === "guardian_finale") {
    return "climax";
  }
  if (current?.campaignPhase === "turn") return "turn";
  if (current?.hardAnchor) return "pressure";
  const index = draft.chapters.findIndex(chapter => chapter.stableChapterId === draft.currentChapterId);
  if (index <= 0) return "build";
  if (index === draft.chapters.length - 1) return "breather";
  return index % 2 === 0 ? "breather" : "build";
}

export function fictionalEncounterDensity(pacing: CampaignPacing): "none" | "sparse" | "present" {
  if (pacing === "quiet" || pacing === "breather") return "none";
  if (pacing === "climax" || pacing === "pressure") return "present";
  return "sparse";
}
