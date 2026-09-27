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
  // The Driver builder targets the exact property the operator entered.
  // Nearby category discovery belongs to territory prospecting, not this flow.
  const discovery = await discoverLaundryTerritory({
    addressOrBusiness: input.searchNear,
    provider: provider(),
    operator,
    categories: [input.searchNear],
    limit: 5,
  });
  const preferredAccountType: Record<DriverMissionVenue, string> = {
    luxury_living: "property_management",
    hotels: "hotel",
    fitness_wellness: "gym",
    salons_spas: "salon_spa",
  };
  const exactOpportunity = discovery.opportunities
    .filter(opportunity => opportunity.distanceMiles <= 0.25)
    .sort((a, b) => {
      const aPreferred =
        a.account.accountType === preferredAccountType[input.venueType] ? 0 : 1;
      const bPreferred =
        b.account.accountType === preferredAccountType[input.venueType] ? 0 : 1;
      return aPreferred - bPreferred || a.distanceMiles - b.distanceMiles;
    })[0];
  if (!exactOpportunity) {
    throw new Error(
      "Could not identify that exact property. Enter the property name and full street address."
    );
  }
  if (input.missionType === "cold_call" && !exactOpportunity.account.phone) {
    throw new Error("That exact property does not have a public phone number.");
  }
  const existing = await listCommercialMissions({ tenantId: input.tenantId, limit: 250 });
  const activeMissions = existing.filter(
    mission => !["won", "lost"].includes(mission.status)
  );
  const reusable = activeMissions.find(
    mission =>
      mission.assignedTo === input.driverId &&
      driverMissionBuilderMode(mission) === input.missionType &&
      mission.account.providerAccountId === exactOpportunity.providerAccountId
  );
  const conflicting = activeMissions.find(
    mission =>
      mission.account.providerAccountId === exactOpportunity.providerAccountId &&
      mission.id !== reusable?.id
  );
  if (conflicting) {
    throw new Error(
      `${exactOpportunity.account.name} already has an active sales mission.`
    );
  }

  if (reusable) {
    await ensureApprovedBuilderProposal({
      tenantId: input.tenantId,
      mission: reusable,
      actorId: input.driverId,
    });
    return [reusable];
  }

  const created: CommercialMission[] = [];
  const opportunity = exactOpportunity;
  const index = 0;
  {
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
