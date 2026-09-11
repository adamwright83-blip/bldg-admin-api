/**
 * Slice 2 — the three-Kingdom sequence.
 *
 * Kingdom 1 (Coliseum) is the existing, live Greystar/Colosseum campaign,
 * expressed through this contract rather than rebuilt. Kingdom 2 (The Last
 * Valet) and Kingdom 3 start unassigned/locked: Kingdom 2's real campaign is
 * Slice 3's job, and Kingdom 3's real challenge is still an open ChatGPT
 * task (docs/GOLDLINE-TASKS.md Backlog).
 */
import { seedKingdomIfMissing } from "./kingdomService";

export async function seedGoldlineKingdoms(tenantId: string) {
  await seedKingdomIfMissing({
    tenantId,
    kingdomId: "kingdom-1-colosseum",
    kingdom: {
      sequence: 1,
      title: "The Colosseum",
      realCampaignId: "greystar-koreatown-colosseum",
      fictionalFieldMission: "colosseum",
      lanternCityStatus: "active",
      driverDayRelevance:
        "Surface whenever an unvisited Greystar Koreatown target is reachable today.",
      companionEarnedId: null,
      enablesKingdomId: "kingdom-2-the-last-valet",
      capabilityRequirement: null,
      selectedAt: null,
    },
  });

  await seedKingdomIfMissing({
    tenantId,
    kingdomId: "kingdom-2-the-last-valet",
    kingdom: {
      sequence: 2,
      title: "The Last Valet",
      // Slice 3 assigns this once the real controllable campaign exists.
      realCampaignId: null,
      fictionalFieldMission: "the-last-valet",
      lanternCityStatus: "locked",
      driverDayRelevance:
        "Surface once Kingdom 1 is complete and this Kingdom's real campaign is assigned (Slice 3).",
      companionEarnedId: null,
      enablesKingdomId: "kingdom-3",
      capabilityRequirement: null,
      selectedAt: null,
    },
  });

  await seedKingdomIfMissing({
    tenantId,
    kingdomId: "kingdom-3",
    kingdom: {
      sequence: 3,
      title: "Kingdom 3",
      realCampaignId: null,
      fictionalFieldMission: "unassigned",
      lanternCityStatus: "locked",
      driverDayRelevance:
        "Not yet relevant — no real challenge selected. See the Kingdom 3 review surface.",
      companionEarnedId: null,
      enablesKingdomId: null,
      capabilityRequirement: null,
      selectedAt: null,
    },
  });
}
