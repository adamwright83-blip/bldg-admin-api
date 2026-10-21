/**
 * Business Memory — the game master view as evidence.
 *
 * The reader itself lives in `server/claire/gameMaster/gameMasterView.ts` so the
 * scheduled-call briefing can share it without importing the brain (production
 * isolation). This module only stamps it: `game_state`, current business truth,
 * operator visible. Read only; see the reader's header for the driver-id split.
 */

import type { EvidenceItem } from "../contracts/evidence";
import { isNoRecord, type GameMasterView } from "../../gameMaster/gameMasterView";

export * from "../../gameMaster/gameMasterView";

export function evidenceFromGameMasterView(input: { view: GameMasterView; observedAtIso: string }): EvidenceItem {
  const { view } = input;
  const day1 = isNoRecord(view.day1TenDoors) ? "no-day1" : view.day1TenDoors.missionId;
  return {
    id: `game_state:${view.activeKingdom?.kingdomId ?? "no-active-kingdom"}:${day1}`,
    type: "game_state",
    source: "gameMasterView",
    provenance: { reader: "readGameMasterView" },
    observedAt: input.observedAtIso,
    asOf: input.observedAtIso,
    freshness: null,
    coverage: { complete: view.gaps.length === 0, gaps: view.gaps },
    authoritativeFor: ["current_business_truth"],
    payload: view,
    operatorVisible: true,
  };
}
