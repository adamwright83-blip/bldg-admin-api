import { randomUUID } from "node:crypto";
import type { CommercialMission } from "@shared/commercialMission";
import { getTerritoryOperatorProfile } from "../territory/territoryStore";
import { GooglePlacesTerritoryProvider } from "../territory/googlePlacesTerritoryProvider";
import {
  discoverLaundryTerritory,
  rankTerritoryCandidate,
  type LaundryTerritoryOperatorContext,
  type RankedTerritoryOpportunity,
  type TerritoryBusinessCandidate,
  type TerritoryBusinessProvider,
} from "../territory/territoryDiscovery";
import {
  createCommercialMission,
  listCommercialMissions,
} from "./commercialMissionStore";
import { activateCommercialMissionForField } from "./commercialMissionActivationService";
import {
  approveCommercialProposal,
  generateCommercialProposal,
  getCommercialProposalProfile,
  getLatestCommercialProposalForMission,
} from "../commercialProposals/commercialProposalService";
import { selectMissionDiamond } from "./driverSalesMotivationService";

export const DRIVER_MISSION_TYPES = ["cold_call", "in_person"] as const;
export type DriverMissionType = (typeof DRIVER_MISSION_TYPES)[number];

export const DRIVER_MISSION_VENUES = [
  "luxury_living",
  "hotels",
  "fitness_wellness",
  "salons_spas",
] as const;
export type DriverMissionVenue = (typeof DRIVER_MISSION_VENUES)[number];

export const DRIVER_MISSION_TARGET_MODES = [
  "exact_property",
  "nearby_discovery",
] as const;
export type DriverMissionTargetMode = (typeof DRIVER_MISSION_TARGET_MODES)[number];

export type DriverMissionPlacesProvider = TerritoryBusinessProvider & {
  resolveBusiness(query: string): Promise<TerritoryBusinessCandidate | null>;
  resolveBusinessByPlaceId?(
    placeId: string
  ): Promise<TerritoryBusinessCandidate | null>;
};

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
  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  const geocodingApiKey = process.env.GOOGLE_GEOCODING_API_KEY ?? "";
  if (!placesApiKey) {
    throw new Error("Google Places is not configured for mission building");
  }
  if (!geocodingApiKey) {
    throw new Error("Google Geocoding is not configured for mission building");
  }
  return new GooglePlacesTerritoryProvider({
    placesApiKey,
    geocodingApiKey,
  });
}

export async function autocompleteDriverMissionPlaces(input: {
  query: string;
  limit?: number;
}) {
  return provider().autocompleteBusinesses(input.query, input.limit ?? 6);
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

async function ensureApprovedBuilderProposal(input: {
  tenantId: string;
  mission: CommercialMission;
  actorId: string;
}) {
  const approved = await getLatestCommercialProposalForMission({
    tenantId: input.tenantId,
    missionId: input.mission.id,
    approvedOnly: true,
  });
  if (approved) return approved;

  const proposal = await generateCommercialProposal({
    tenantId: input.tenantId,
    missionId: input.mission.id,
    actorId: input.actorId,
    requestId: randomUUID(),
  });
  return approveCommercialProposal({
    tenantId: input.tenantId,
    missionId: input.mission.id,
    proposalId: proposal.id,
    actorId: input.actorId,
    requestId: randomUUID(),
  });
}

export async function resolveDriverMissionTargets(input: {
  targetMode: DriverMissionTargetMode;
  searchNear: string;
  placeId?: string | null;
  venueType: DriverMissionVenue;
  count: number;
  operator: LaundryTerritoryOperatorContext;
  places: DriverMissionPlacesProvider;
}): Promise<{
  opportunities: RankedTerritoryOpportunity[];
  exactTarget: TerritoryBusinessCandidate | null;
}> {
  if (input.targetMode === "exact_property") {
    const exactTarget =
      input.placeId && input.places.resolveBusinessByPlaceId
        ? await input.places.resolveBusinessByPlaceId(input.placeId)
        : await input.places.resolveBusiness(input.searchNear);
    if (!exactTarget) {
      throw new Error(
        "Could not identify this property. Check the exact property name or address, or choose Find prospects near this location."
      );
    }
    return {
      exactTarget,
      opportunities: [
        rankTerritoryCandidate({
          candidate: exactTarget,
          center: {
            lat: exactTarget.lat,
            lng: exactTarget.lng,
            formattedAddress: exactTarget.formattedAddress,
          },
          operator: input.operator,
        }),
      ],
    };
  }

  const discovery = await discoverLaundryTerritory({
    addressOrBusiness: input.searchNear,
    provider: input.places,
    operator: input.operator,
    categories: SEARCH_CATEGORIES[input.venueType],
    limit: 20,
  });
  return {
    exactTarget: null,
    opportunities: discovery.opportunities.slice(0, input.count),
  };
}

export async function buildDriverMissions(input: {
  tenantId: string;
  driverId: string;
  missionType: DriverMissionType;
  venueType: DriverMissionVenue;
  targetMode: DriverMissionTargetMode;
  searchNear: string;
  placeId?: string;
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
  const places = provider();
  const { opportunities, exactTarget } = await resolveDriverMissionTargets({
    targetMode: input.targetMode,
    searchNear: input.searchNear,
    placeId: input.placeId,
    venueType: input.venueType,
    count: input.count,
    operator,
    places,
  });
  const existing = await listCommercialMissions({ tenantId: input.tenantId, limit: 250 });
  const activeMissions = existing.filter(
    mission => !["won", "lost"].includes(mission.status)
  );
  const activeProviderIds = new Set(
    activeMissions
      .map(mission => mission.account.providerAccountId)
      .filter((value): value is string => Boolean(value))
  );
  const reusableByProviderId = new Map(
    activeMissions
      .filter(
        mission =>
          mission.assignedTo === input.driverId &&
          driverMissionBuilderMode(mission) === input.missionType &&
          Boolean(mission.account.providerAccountId)
      )
      .map(mission => [mission.account.providerAccountId as string, mission])
  );
  const eligible = opportunities.filter(opportunity => {
    const reusable = reusableByProviderId.get(opportunity.providerAccountId);
    if (reusable) return true;
    return (
      !activeProviderIds.has(opportunity.providerAccountId) &&
      (input.missionType !== "cold_call" || Boolean(opportunity.account.phone))
    );
  });
  if (!eligible.length) {
    if (input.targetMode === "exact_property" && exactTarget) {
      if (activeProviderIds.has(exactTarget.providerId)) {
        throw new Error("An active mission already exists for this property.");
      }
      if (input.missionType === "cold_call") {
        throw new Error(
          "This property does not have a public phone number for a cold-call mission."
        );
      }
      throw new Error("This property is not eligible for a new mission.");
    }
    throw new Error(
      input.missionType === "cold_call"
        ? "No new venues with public phone numbers were found near this route"
        : "No new venues were found near this route"
    );
  }

  const created: CommercialMission[] = [];
  const selected = eligible.slice(
    0,
    input.targetMode === "exact_property" ? 1 : input.count
  );
  for (let index = 0; index < selected.length; index += 1) {
    const opportunity = selected[index]!;
    const reusable = reusableByProviderId.get(opportunity.providerAccountId);
    if (reusable) {
      const recovered =
        reusable.status === "candidate" || reusable.status === "selected"
          ? await activateCommercialMissionForField({
              tenantId: input.tenantId,
              missionId: reusable.id,
              expectedVersion: reusable.version,
              assignedTo: input.driverId,
              actorId: input.driverId,
              requestId: randomUUID(),
            })
          : reusable;
      await ensureApprovedBuilderProposal({
        tenantId: input.tenantId,
        mission: recovered,
        actorId: input.driverId,
      });
      created.push(recovered);
      continue;
    }

    const diamond = await selectMissionDiamond({
      tenantId: input.tenantId,
      driverId: input.driverId,
      accountType: opportunity.account.accountType,
    });
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
            targetMode: input.targetMode,
            targetQuery: input.searchNear,
            ...(input.placeId ? { targetPlaceId: input.placeId } : {}),
          },
          {
            source: "driver_sales_diamond",
            ...diamond,
            selectedAt: new Date().toISOString(),
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
    await ensureApprovedBuilderProposal({
      tenantId: input.tenantId,
      mission: activated,
      actorId: input.driverId,
    });
    created.push(activated);
  }
  return created;
}
