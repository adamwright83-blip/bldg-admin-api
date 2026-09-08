import { getGeographicTruth } from "../geography/geographicTruthService";
import { getRevenueSummary } from "../analytics/analyticsQueries";
import { getOrMaterializeTodayCampaign } from "./campaignService";
import { classifyTerritory } from "../../shared/lanternTerritories";
import {
  hostForBinding,
  surfaceForCampaignHost,
} from "../../shared/goldlineCampaignRuntime";

// The denominator is exactly the authored V6 board: one entry for every
// TERRITORY_PRESENTATION key. It is intentionally not a discovered-data count.
export const AUTHORED_V6_TERRITORY_IDS = [
  "koreatown",
  "century-city",
  "beverly-hills",
  "west-hollywood",
  "hollywood",
  "los-feliz",
  "silver-lake",
  "east-hollywood",
  "mid-city",
  "echo-park",
  "downtown",
  "westlake",
  "arts-district",
  "hollywood-hills-west",
] as const;

type Atlas = Awaited<ReturnType<typeof getGeographicTruth>>;
type Customer = Atlas["customers"][number];

export type LanternTerritoryDossier = {
  territoryId: string;
  territoryName: string;
  counts: { total: number; active: number; dimming: number; dark: number };
  knownLight: null | Pick<
    Customer,
    | "identityKey"
    | "displayName"
    | "phone"
    | "totalOrders"
    | "firstOrderAt"
    | "lastOrderAt"
    | "cadence"
  >;
};

export function projectLanternCityOverview(input: {
  atlas: Atlas;
  paidRevenueThisWeek: number;
  campaign: Awaited<ReturnType<typeof getOrMaterializeTodayCampaign>>;
}) {
  const byTerritory = new Map<string, Customer[]>();
  for (const customer of input.atlas.customers) {
    if (!customer.location) continue;
    const territory = classifyTerritory(
      customer.location.latitude,
      customer.location.longitude
    );
    if (
      territory &&
      AUTHORED_V6_TERRITORY_IDS.includes(territory.id as never)
    ) {
      byTerritory.set(territory.id, [
        ...(byTerritory.get(territory.id) ?? []),
        customer,
      ]);
    }
  }
  const dossiers: LanternTerritoryDossier[] = AUTHORED_V6_TERRITORY_IDS.map(
    territoryId => {
      const customers = byTerritory.get(territoryId) ?? [];
      const territoryName = customers[0]?.location
        ? (classifyTerritory(
            customers[0].location.latitude,
            customers[0].location.longitude
          )?.name ?? territoryId)
        : territoryId
            .split("-")
            .map(word => word[0]!.toUpperCase() + word.slice(1))
            .join(" ");
      const counts = customers.reduce(
        (mix, customer) => {
          mix[customer.cadence.state] += 1;
          mix.total += 1;
          return mix;
        },
        { total: 0, active: 0, dimming: 0, dark: 0 }
      );
      const knownLight =
        [...customers]
          .filter(customer => customer.cadence.state === "dark")
          .sort(
            (a, b) =>
              b.cadence.daysSinceLastOrder - a.cadence.daysSinceLastOrder ||
              a.identityKey.localeCompare(b.identityKey)
          )[0] ?? null;
      return {
        territoryId,
        territoryName,
        counts,
        knownLight: knownLight
          ? {
              identityKey: knownLight.identityKey,
              displayName: knownLight.displayName,
              phone: knownLight.phone,
              totalOrders: knownLight.totalOrders,
              firstOrderAt: knownLight.firstOrderAt,
              lastOrderAt: knownLight.lastOrderAt,
              cadence: knownLight.cadence,
            }
          : null,
      };
    }
  );
  const currentChapter =
    input.campaign.campaign.chapters.find(
      chapter =>
        chapter.stableChapterId === input.campaign.campaign.currentChapterId
    ) ?? null;
  const recovery =
    [...dossiers]
      .filter(dossier => dossier.counts.dark > 0)
      .sort(
        (a, b) =>
          b.counts.dark - a.counts.dark ||
          a.territoryId.localeCompare(b.territoryId)
      )[0] ?? null;
  const featuredTerritory = currentChapter?.territoryId
    ? (dossiers.find(
        dossier => dossier.territoryId === currentChapter.territoryId
      ) ?? recovery)
    : recovery;
  const knownLight = featuredTerritory?.knownLight ?? null;
  const operationStartedAt = input.campaign.campaign.startedAt ?? null;
  const secondLightCustomer =
    featuredTerritory && operationStartedAt
      ? ((byTerritory.get(featuredTerritory.territoryId) ?? [])
          .filter(
            customer =>
              new Date(customer.firstOrderAt).getTime() >
              new Date(operationStartedAt).getTime()
          )
          .sort(
            (a, b) =>
              new Date(a.firstOrderAt).getTime() -
                new Date(b.firstOrderAt).getTime() ||
              a.identityKey.localeCompare(b.identityKey)
          )[0] ?? null)
      : null;
  const binding = currentChapter?.selectedGameplayBinding ?? "recovery";
  const isFixedCommitment = Boolean(
    currentChapter?.required || currentChapter?.hardAnchor
  );
  const title = currentChapter
    ? currentChapter.selectedGameplayBinding === "authoritative_visit_route"
      ? "HOLD THE ROUTE"
      : currentChapter.selectedGameplayBinding === "recovery"
        ? "RESTORE THE LIGHT"
        : currentChapter.selectedGameplayBinding === "guardian_finale"
          ? "FACE THE GUARDIAN"
          : "ADVANCE THE CAMPAIGN"
    : featuredTerritory
      ? featuredTerritory.counts.dark >= 3
        ? "PURGE THE RAT NEST"
        : "KEEP THE LIGHTS ON"
      : "EXPLORE LANTERN CITY";
  const objectives = featuredTerritory
    ? [
        ...(knownLight
          ? [
              {
                id: `relight:${knownLight.identityKey}`,
                label: `RELIGHT ${knownLight.displayName.toUpperCase()}`,
                current: knownLight.cadence.state === "dark" ? 0 : 1,
                target: 1,
              },
            ]
          : []),
        {
          id: `restore:${featuredTerritory.territoryId}`,
          label: "RESTORE DORMANT LIGHTS",
          current: 0,
          target: featuredTerritory.counts.dark,
        },
        {
          id: `second-light:${featuredTerritory.territoryId}`,
          label: "ESTABLISH THE SECOND LIGHT",
          current: secondLightCustomer ? 1 : 0,
          target: 1,
        },
      ].filter(objective => objective.target > 0)
    : [];
  const otherOpportunityCount = Math.max(
    0,
    dossiers.filter(
      dossier => dossier.counts.dark > 0 || dossier.counts.total === 0
    ).length - (featuredTerritory ? 1 : 0)
  );
  const dark = input.atlas.customers.filter(
    customer => customer.cadence.state === "dark"
  ).length;
  return {
    businessDate: input.atlas.businessDate,
    timeZone: input.atlas.timeZone,
    scoreboard: {
      customers: input.atlas.customers.length,
      districtsLit: {
        numerator: dossiers.filter(
          dossier => dossier.counts.active + dossier.counts.dimming > 0
        ).length,
        denominator: AUTHORED_V6_TERRITORY_IDS.length,
        provenance:
          "Authored V6 districts with at least one real non-dark customer",
      },
      paidRevenueThisWeek: input.paidRevenueThisWeek,
      dormant: { numerator: dark, denominator: input.atlas.customers.length },
      revenueProvenance:
        "Paid admin-app orders by paidAt, Monday through business date",
    },
    featuredOperation: {
      id:
        currentChapter?.stableChapterId ??
        (featuredTerritory
          ? `${input.atlas.businessDate}:recovery:${featuredTerritory.territoryId}`
          : `${input.atlas.businessDate}:explore`),
      title,
      territoryId: featuredTerritory?.territoryId ?? null,
      territoryName: featuredTerritory?.territoryName ?? "Los Angeles",
      briefing: featuredTerritory
        ? `${featuredTerritory.territoryName} is losing light. Restore real service and establish the next light through real business.`
        : "The city is quiet. Explore the board and review real customer lights.",
      objectives,
      binding,
      host: hostForBinding(binding),
      surface: surfaceForCampaignHost(binding),
      isFixedCommitment,
      knownLightIdentityKey: knownLight?.identityKey ?? null,
      secondLight: featuredTerritory
        ? {
            id: `second-light:${featuredTerritory.territoryId}`,
            territoryId: featuredTerritory.territoryId,
            status: secondLightCustomer
              ? ("completed_by_real_customer" as const)
              : ("waiting_for_reality" as const),
            personIdentity: null,
            completedCustomerIdentityKey:
              secondLightCustomer?.identityKey ?? null,
          }
        : null,
    },
    otherOpportunityCount,
    territoryDossiers: dossiers,
  };
}

function mondayThrough(businessDate: string) {
  const date = new Date(`${businessDate}T12:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return { start: date.toISOString().slice(0, 10), end: businessDate };
}

export async function getLanternCityOverview(input: {
  tenantId: string;
  operatorId: string;
}) {
  const atlas = await getGeographicTruth({ tenantId: input.tenantId });
  const [campaign, revenue] = await Promise.all([
    getOrMaterializeTodayCampaign(input),
    getRevenueSummary(input.tenantId, {
      range: mondayThrough(atlas.businessDate),
      groupBy: "week",
      basis: "paidAt",
    }),
  ]);
  return projectLanternCityOverview({
    atlas,
    campaign,
    paidRevenueThisWeek: revenue.totalRevenue,
  });
}
