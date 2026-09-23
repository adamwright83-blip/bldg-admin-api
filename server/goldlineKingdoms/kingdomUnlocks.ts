/**
 * Slice 5 §5.4 — legacy lantern status for stored kingdom rows.
 *
 * Stored row `kingdom-1-colosseum` moves to lantern status `complete` when
 * all five Greystar Koreatown lead-hunt targets — not all ten day1TenDoors
 * targets, see docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md —
 * have a recorded visit outcome. That unlocks stored row
 * `kingdom-2-the-last-valet` on the map. Evidence is
 * `colosseumKingdomBindingSatisfied`. The row ids are not renamed.
 *
 * Per Adam's decision (2026-09-11): the newly-unlocked row leads to
 * /goldline-chapter access. See GoldlineKingdomAdmin.tsx and
 * GoldlineDriverController.tsx for where that surfaces.
 *
 * `kingdom-1-colosseum` is not `kingdom.brass_republic`. This lantern write
 * does not resolve `level.colosseum`, own `companion.rook`, or complete
 * the Kingdom. Those flags are the read in `server/goldlineProgression/`.
 */
import { getOrCreateDay1TenDoorsMission } from "../openChannel/day1TenDoorsService";
import { colosseumKingdomBindingSatisfied } from "../goldlineProgression/colosseumKingdomBinding";
import { getKingdom, listKingdoms, setKingdomStatus } from "./kingdomService";
import type { GoldlineKingdom } from "./kingdomTypes";

/**
 * Existing evidence predicate, now named `colosseumKingdomBindingSatisfied`.
 * Kept as the local call site for the legacy lantern-status write below.
 * That write updates stored row `kingdom-1-colosseum` only. It is not
 * `kingdom.brass_republic` completed and it is not `level.colosseum` resolved.
 */
function isColosseumComplete(outcomes: Record<string, unknown>): boolean {
  return colosseumKingdomBindingSatisfied(outcomes);
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
