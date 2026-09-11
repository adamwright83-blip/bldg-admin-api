/**
 * Slice 5 §5.4 — real Kingdom-completion derivation.
 *
 * Kingdom completion must come from real recorded truth, never fictional
 * persistence. Kingdom 1 (the Colosseum) is complete when all five real
 * targets in the Greystar lead hunt — not all ten day1TenDoors targets,
 * see docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md — have a
 * recorded visit outcome. Completing it unlocks Kingdom 2 on the map.
 *
 * Per Adam's decision (2026-09-11): the newly-unlocked Kingdom leads to
 * /goldline-chapter access. See GoldlineKingdomAdmin.tsx and
 * GoldlineDriverController.tsx for where that surfaces.
 */
import { getOrCreateDay1TenDoorsMission } from "../openChannel/day1TenDoorsService";
import { leadHuntDefinitionForCampaign } from "../campaignLibrary/leadHuntRoundTrip";
import { getKingdom, listKingdoms, setKingdomStatus } from "./kingdomService";
import type { GoldlineKingdom } from "./kingdomTypes";

const COLOSSEUM_LEGACY_REF = { leadHuntId: "greystar-koreatown-five" } as const;

function isColosseumComplete(outcomes: Record<string, unknown>): boolean {
  const definition = leadHuntDefinitionForCampaign({
    legacyContract: "lead_hunt",
    legacyContractRef: COLOSSEUM_LEGACY_REF,
  });
  if (!definition) return false;
  const recorded = new Set(Object.keys(outcomes));
  return definition.targetIds.every(id => recorded.has(id));
}

/**
 * Idempotent. Safe to call on every read (matches the nightShift
 * getOrAuthor pattern) — it only ever moves a Kingdom forward, never back,
 * and only when the real underlying campaign proves it.
 */
export async function deriveKingdomStatuses(input: {
  tenantId: string;
  operatorId: string;
}): Promise<GoldlineKingdom[]> {
  const kingdom1 = await getKingdom({ tenantId: input.tenantId, kingdomId: "kingdom-1-colosseum" });
  const kingdom2 = await getKingdom({ tenantId: input.tenantId, kingdomId: "kingdom-2-the-last-valet" });
  if (kingdom1 && kingdom1.lanternCityStatus !== "complete") {
    try {
      const mission = await getOrCreateDay1TenDoorsMission({
        tenantId: input.tenantId,
        driverId: input.operatorId,
      });
      if (isColosseumComplete(mission.outcomes)) {
        await setKingdomStatus({
          tenantId: input.tenantId,
          kingdomId: "kingdom-1-colosseum",
          lanternCityStatus: "complete",
        });
        if (kingdom2 && kingdom2.lanternCityStatus === "locked") {
          await setKingdomStatus({
            tenantId: input.tenantId,
            kingdomId: "kingdom-2-the-last-valet",
            lanternCityStatus: "active",
          });
        }
      }
    } catch (error) {
      // Fail closed: an unresolvable real-campaign check never unlocks
      // anything. The Kingdom stays exactly as it was.
      console.warn(
        "[Kingdoms] Could not check Colosseum completion",
        error instanceof Error ? error.message : error
      );
    }
  }
  return listKingdoms({ tenantId: input.tenantId });
}
