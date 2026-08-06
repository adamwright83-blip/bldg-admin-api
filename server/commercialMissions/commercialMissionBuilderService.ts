import { randomUUID } from "node:crypto";
import type { CommercialMission } from "@shared/commercialMission";
import { getTerritoryOperatorProfile } from "../territory/territoryStore";
import { GooglePlacesTerritoryProvider } from "../territory/googlePlacesTerritoryProvider";
import { discoverLaundryTerritory } from "../territory/territoryDiscovery";
import {
  createCommercialMission,
  listCommercialMissions,
} from "./commercialMissionStore";
import { activateCommercialMissionForField } from "./commercialMissionActivationService";
import {
  approveCommercialProposal,
  generateCommercialProposal,
  getCommercialProposalProfile,
} from "../commercialProposals/commercialProposalService";

export const DRIVER_MISSION_TYPES = ["cold_call", "in_person"] as const;
export type DriverMissionType = (typeof DRIVER_MISSION_TYPES)[number];

export const DRIVER_MISSION_VENUES = [
  "luxury_living",
  "hotels",
  "fitness_wellness",
  "salons_spas",
] as const;
export type DriverMissionVenue = (typeof DRIVER_MISSION_VENUES)[number];

const SEARCH_CATEGORIES: Record<DriverMissionVenue, string[]> = {
  luxury_living: [
    "luxury apartment building",
    "high rise apartment building",
    "property management company",
  ],
  hotels: ["luxury hotel", "boutique hotel"],
  fitness_wellness: ["luxury gym", "fitness club", "wellness center"],
  salons_spas: ["salon", "day spa", "med spa"],
};

function provider() {
  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
  if (!apiKey) throw new Error("Google Places is not configured for mission building");
  return new GooglePlacesTerritoryProvider(apiKey);
}

function builderMetadata(mission: CommercialMission) {
  return mission.opportunity.evidence?.find(
    item => item.source === "driver_mission_builder"
  );
}

export function driverMissionBuilderMode(mission: CommercialMission) {
  const value = builderMetadata(mission)?.missionType;
  return value === "cold_call" || value === "in_person" ? value : null;
}

export async function listDriverBuiltMissions(input: {
  tenantId: string;
  driverId: string;
}) {
  const missions = await listCommercialMissions({ tenantId: input.tenantId, limit: 250 });
  return missions.filter(
    mission =>
      mission.assignedTo === input.driverId &&
      driverMissionBuilderMode(mission) !== null &&
      !["won", "lost"].includes(mission.status)
  );
}

export async function buildDriverMissions(input: {
  tenantId: string;
  driverId: string;
  missionType: DriverMissionType;
  venueType: DriverMissionVenue;
  searchNear: string;
  requestId: string;
  count: number;
}) {
  const proposalProfile = await getCommercialProposalProfile(input.tenantId);
  if (!proposalProfile) {
    throw new Error("Configure the commercial proposal profile before building field missions");
  }
  const storedOperator = await getTerritoryOperatorProfile(input.tenantId);
  const operator = storedOperator ?? {
    tenantId: input.tenantId,
    serviceRadiusMiles: 5,
    commercialWashFoldEnabled: true,
    averagePricePerPoundCents: 225,
    availableWeeklyCapacityPounds: 2_000,
    routePoints: [],
    turnaroundCompatibleByDefault: true,
    pickupDaysCompatibleByDefault: true,
  };
  const discovery = await discoverLaundryTerritory({
    addressOrBusiness: input.searchNear,
    provider: provider(),
    operator,
    categories: SEARCH_CATEGORIES[input.venueType],
    limit: 20,
  });
  const existing = await listCommercialMissions({ tenantId: input.tenantId, limit: 250 });
  const activeProviderIds = new Set(
    existing
      .filter(mission => !["won", "lost"].includes(mission.status))
      .map(mission => mission.account.providerAccountId)
      .filter((value): value is string => Boolean(value))
  );
  const eligible = discovery.opportunities.filter(
    opportunity =>
      !activeProviderIds.has(opportunity.providerAccountId) &&
      (input.missionType !== "cold_call" || Boolean(opportunity.account.phone))
  );
  if (!eligible.length) {
    throw new Error(
      input.missionType === "cold_call"
        ? "No new venues with public phone numbers were found near this route"
        : "No new venues were found near this route"
    );
  }

  const created: CommercialMission[] = [];
  const selected = eligible.slice(0, input.count);
  for (let index = 0; index < selected.length; index += 1) {
    const opportunity = selected[index]!;
    const mission = await createCommercialMission({
      tenantId: input.tenantId,
      assignedTo: input.driverId,
      account: {
        providerName: opportunity.providerName,
        providerAccountId: opportunity.providerAccountId,
        name: opportunity.account.name,
        accountType: opportunity.account.accountType,
        website: opportunity.account.website,
        address: opportunity.account.address,
        latitude: opportunity.account.latitude,
        longitude: opportunity.account.longitude,
        locationCount: opportunity.account.locationCount,
        decisionMaker: {
          ...opportunity.account.decisionMaker,
          phone: opportunity.account.phone,
          relationshipType: "unknown",
          preferredChannel: input.missionType === "cold_call" ? "phone" : "unknown",
          source: "provider_sourced",
          sourceUrl: null,
          sourcedAt: new Date().toISOString(),
          notes: `Built in the driver app as a ${input.missionType.replace("_", " ")} mission.`,
        },
      },
      opportunity: {
        estimatedAnnualValueCents: opportunity.score.estimatedAnnualValueCents,
        estimateConfidence: opportunity.score.grade,
        score: opportunity.score.score,
        primarySignal: opportunity.primarySignal,
        reasons: opportunity.score.reasons,
        risks: opportunity.score.risks,
        evidence: [
          ...opportunity.evidence.map((item: Record<string, unknown>) => ({ ...item })),
          {
            source: "driver_mission_builder",
            missionType: input.missionType,
            venueType: input.venueType,
            builtBy: input.driverId,
            requestId: input.requestId,
          },
        ],
      },
      brief: {
        laundryOpportunity: `Recurring laundry service for ${opportunity.account.name}.`,
        salesAngle:
          input.venueType === "luxury_living"
            ? "Offer a premium resident laundry amenity with scheduled pickup and delivery."
            : "Offer a reliable recurring pickup-and-delivery laundry program.",
        openingLine:
          input.missionType === "cold_call"
            ? `Hi, I run Laundry Butler nearby. Who handles resident or property laundry partnerships for ${opportunity.account.name}?`
            : `Hi, I run Laundry Butler nearby and wanted to introduce our pickup-and-delivery laundry service. Who handles resident or property partnerships here?`,
        discoveryQuestions: [
          "How is laundry handled for residents, staff, or shared items today?",
          "Who evaluates new resident amenities and service partners?",
          "Would a small pilot at one property be useful?",
        ],
        objections: ["Current provider", "Pricing", "Resident adoption", "Pickup schedule"],
      },
      steps: [
        { key: "scout", label: "Scout", detail: "Review sourced venue facts.", status: "completed", position: 0 },
        { key: "prepare", label: "Prepare", detail: "Review the pitch before outreach.", status: "ready", position: 1 },
        { key: "battle", label: "Battle", detail: "Complete BORESLAY to unlock the sales stop.", status: "locked", position: 2 },
        { key: "field", label: "Field", detail: input.missionType === "cold_call" ? "Make and log the call." : "Visit and log the sales outcome.", status: "locked", position: 3 },
      ],
      actor: { type: "driver", id: input.driverId },
      idempotencyKey: `driver-build:${input.requestId}:${index}`,
    });
    const activated = await activateCommercialMissionForField({
        tenantId: input.tenantId,
        missionId: mission.id,
        expectedVersion: mission.version,
        assignedTo: input.driverId,
        actorId: input.driverId,
        requestId: randomUUID(),
      });
    const proposal = await generateCommercialProposal({
      tenantId: input.tenantId,
      missionId: activated.id,
      actorId: input.driverId,
      requestId: randomUUID(),
    });
    await approveCommercialProposal({
      tenantId: input.tenantId,
      missionId: activated.id,
      proposalId: proposal.id,
      actorId: input.driverId,
      requestId: randomUUID(),
    });
    created.push(activated);
  }
  return created;
}
