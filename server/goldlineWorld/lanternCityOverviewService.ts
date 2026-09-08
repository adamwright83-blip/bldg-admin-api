import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  goldlineLanternOperations,
  goldlineTerritoryDefinitions,
} from "../../drizzle/schema";
import {
  hostForBinding,
  surfaceForCampaignHost,
} from "../../shared/goldlineCampaignRuntime";
import {
  classifyTerritory,
  territoryByName,
} from "../../shared/lanternTerritories";
import { deriveTerritoryVisualState } from "../../shared/lanternTerritoryVisualState";
import {
  decayForecastLine,
  forecastTerritoryDecay,
} from "../../shared/lanternDecayForecast";
import { getRevenueSummary } from "../analytics/analyticsQueries";
import { getDb } from "../db";
import { getGeographicTruth } from "../geography/geographicTruthService";
import { getOrMaterializeTodayCampaign } from "./campaignService";

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
type Campaign = Awaited<ReturnType<typeof getOrMaterializeTodayCampaign>>;
export type LanternOperationBaseline = {
  id: string;
  stableKey: string;
  sourceCampaignChapterId: string | null;
  operationType: "campaign" | "recovery" | "explore";
  campaignTerritoryDefinitionId: string | null;
  lanternCityTerritoryId: string | null;
  startedAt: string;
  baselineCustomerIdentityKeys: string[];
  baselineDormantIdentityKeys: string[];
  anchorCustomerIdentityKey: string | null;
};
export type LanternTerritoryDossier = {
  territoryId: string;
  territoryName: string;
  counts: { total: number; active: number; dimming: number; dark: number };
  decayForecast: string | null;
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

export function resolveChapterLanternTerritory(
  chapter: Campaign["campaign"]["chapters"][number] | null,
  definitions: Array<{ id: string; realGeographyLabel: string | null }>
) {
  const campaignTerritoryDefinitionId = chapter?.territoryId ?? null;
  const label = definitions.find(
    d => d.id === campaignTerritoryDefinitionId
  )?.realGeographyLabel;
  const anchor = chapter?.physicalAnchors?.find(
    a => Number.isFinite(a.latitude) && Number.isFinite(a.longitude)
  );
  return {
    campaignTerritoryDefinitionId,
    lanternCityTerritoryId:
      (label ? territoryByName(label)?.id : null) ??
      (anchor
        ? classifyTerritory(anchor.latitude!, anchor.longitude!)?.id
        : null) ??
      null,
  };
}
function visualEnvironment(d: LanternTerritoryDossier) {
  const state = deriveTerritoryVisualState({
    ...d.counts,
    territoryId: d.territoryId,
    guarded: false,
    conquered: false,
    pressureReturned: false,
  });
  return ["infested", "overgrown", "closed_construction"].includes(state)
    ? "infested"
    : state === "healthy"
      ? "healthy"
      : state === "locked_opportunity"
        ? "locked"
        : "cooling";
}
function returned(customer: Customer | undefined, startedAt: string) {
  return (
    !!customer &&
    customer.cadence.state !== "dark" &&
    new Date(customer.lastOrderAt).getTime() > new Date(startedAt).getTime()
  );
}

export function projectLanternCityOverview(input: {
  atlas: Atlas;
  paidRevenueThisWeek: number;
  campaign: Campaign;
  resolvedCampaignTerritory?: {
    campaignTerritoryDefinitionId: string | null;
    lanternCityTerritoryId: string | null;
  };
  operation?: LanternOperationBaseline;
}) {
  const grouped = new Map<string, Customer[]>();
  for (const c of input.atlas.customers) {
    if (!c.location) continue;
    const t = classifyTerritory(c.location.latitude, c.location.longitude);
    if (t && AUTHORED_V6_TERRITORY_IDS.includes(t.id as never))
      grouped.set(t.id, [...(grouped.get(t.id) ?? []), c]);
  }
  const dossiers: LanternTerritoryDossier[] = AUTHORED_V6_TERRITORY_IDS.map(
    territoryId => {
      const customers = grouped.get(territoryId) ?? [];
      const territory = customers[0]?.location
        ? classifyTerritory(
            customers[0].location.latitude,
            customers[0].location.longitude
          )
        : null;
      const counts = customers.reduce(
        (m, c) => {
          m[c.cadence.state]++;
          m.total++;
          return m;
        },
        { total: 0, active: 0, dimming: 0, dark: 0 }
      );
      const knownLight =
        [...customers]
          .filter(c => c.cadence.state === "dark")
          .sort(
            (a, b) =>
              b.cadence.daysSinceLastOrder - a.cadence.daysSinceLastOrder ||
              a.identityKey.localeCompare(b.identityKey)
          )[0] ?? null;
      return {
        territoryId,
        territoryName:
          territory?.name ??
          territoryId
            .split("-")
            .map(w => w[0]!.toUpperCase() + w.slice(1))
            .join(" "),
        counts,
        decayForecast: decayForecastLine(
          forecastTerritoryDecay({
            territoryId,
            customers: customers.map(customer => ({
              identityKey: customer.identityKey,
              cadence: customer.cadence,
            })),
            occupancy: {
              guarded: false,
              conquered: false,
              pressureReturned: false,
            },
          })
        ),
        knownLight,
      };
    }
  );
  const chapter =
    input.campaign.campaign.chapters.find(
      c => c.stableChapterId === input.campaign.campaign.currentChapterId
    ) ?? null;
  const resolved = input.resolvedCampaignTerritory ?? {
    campaignTerritoryDefinitionId: chapter?.territoryId ?? null,
    lanternCityTerritoryId: null,
  };
  const recovery =
    [...dossiers]
      .filter(d => d.counts.dark > 0)
      .sort(
        (a, b) =>
          b.counts.dark - a.counts.dark ||
          a.territoryId.localeCompare(b.territoryId)
      )[0] ?? null;
  const territoryId =
    input.operation?.lanternCityTerritoryId ??
    (chapter
      ? resolved.lanternCityTerritoryId
      : (recovery?.territoryId ?? null));
  const dossier = dossiers.find(d => d.territoryId === territoryId) ?? null;
  const isRecovery =
    input.operation?.operationType === "recovery" ||
    (!input.operation && !chapter && !!dossier);
  const startedAt = input.operation?.startedAt ?? new Date().toISOString();
  const baselineCustomers =
    input.operation?.baselineCustomerIdentityKeys ??
    (dossier
      ? (grouped.get(dossier.territoryId) ?? []).map(c => c.identityKey)
      : []);
  const baselineDormant =
    input.operation?.baselineDormantIdentityKeys ??
    (isRecovery && dossier
      ? (grouped.get(dossier.territoryId) ?? [])
          .filter(c => c.cadence.state === "dark")
          .map(c => c.identityKey)
      : []);
  const anchorKey =
    input.operation?.anchorCustomerIdentityKey ??
    (isRecovery ? (dossier?.knownLight?.identityKey ?? null) : null);
  const identities = new Map(
    input.atlas.customers.map(c => [c.identityKey, c])
  );
  const anchor = anchorKey ? identities.get(anchorKey) : undefined;
  const recovered = baselineDormant.filter(k =>
    returned(identities.get(k), startedAt)
  ).length;
  const second =
    dossier && isRecovery
      ? ((grouped.get(dossier.territoryId) ?? [])
          .filter(
            c =>
              !baselineCustomers.includes(c.identityKey) &&
              new Date(c.firstOrderAt).getTime() > new Date(startedAt).getTime()
          )
          .sort(
            (a, b) =>
              new Date(a.firstOrderAt).getTime() -
              new Date(b.firstOrderAt).getTime()
          )[0] ?? null)
      : null;
  const binding = chapter?.selectedGameplayBinding ?? "recovery";
  const environment = dossier ? visualEnvironment(dossier) : null;
  const title = chapter
    ? binding === "authoritative_visit_route"
      ? "HOLD THE ROUTE"
      : binding === "guardian_finale"
        ? "FACE THE GUARDIAN"
        : "ADVANCE THE CAMPAIGN"
    : dossier
      ? environment === "infested"
        ? "PURGE THE RAT NEST"
        : "RESTORE THE LIGHT"
      : "EXPLORE LANTERN CITY";
  const objectives =
    isRecovery && dossier
      ? [
          ...(anchorKey
            ? [
                {
                  id: `relight:${anchorKey}`,
                  label: `RELIGHT ${(anchor?.displayName ?? anchorKey).toUpperCase()}`,
                  current: returned(anchor, startedAt) ? 1 : 0,
                  target: 1,
                },
              ]
            : []),
          {
            id: `restore:${dossier.territoryId}`,
            label: "RESTORE DORMANT LIGHTS",
            current: recovered,
            target: baselineDormant.length,
          },
          {
            id: `second-light:${dossier.territoryId}`,
            label: "ESTABLISH THE SECOND LIGHT",
            current: second ? 1 : 0,
            target: 1,
          },
        ].filter(o => o.target > 0)
      : chapter
        ? [
            {
              id: `commitment:${chapter.stableChapterId}`,
              label:
                chapter.fictionalTreatment || "COMPLETE REQUIRED COMMITMENT",
              current: 0,
              target: 1,
            },
          ]
        : [];
  const dark = input.atlas.customers.filter(
    c => c.cadence.state === "dark"
  ).length;
  const campaignOthers = input.campaign.campaign.chapters.filter(
    c =>
      c.stableChapterId !== chapter?.stableChapterId &&
      !input.campaign.campaign.completedChapterIds?.includes(c.stableChapterId)
  ).length;
  const recoveryOthers = dossiers.filter(
    d => d.counts.dark > 0 && d.territoryId !== territoryId
  ).length;
  return {
    businessDate: input.atlas.businessDate,
    timeZone: input.atlas.timeZone,
    scoreboard: {
      customers: input.atlas.customers.length,
      districtsLit: {
        numerator: dossiers.filter(d => d.counts.active + d.counts.dimming > 0)
          .length,
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
        input.operation?.id ??
        chapter?.stableChapterId ??
        `${input.atlas.businessDate}:${dossier ? `recovery:${dossier.territoryId}` : "explore"}`,
      title,
      territoryId,
      lanternCityTerritoryId: territoryId,
      campaignTerritoryDefinitionId:
        input.operation?.campaignTerritoryDefinitionId ??
        resolved.campaignTerritoryDefinitionId,
      territoryName: dossier?.territoryName ?? "Los Angeles",
      briefing:
        dossier && isRecovery
          ? `${dossier.territoryName} is losing light. Restore real service and establish the next light through real business.`
          : chapter?.fictionalTreatment ||
            "The city is quiet. Explore the board and review real customer lights.",
      objectives,
      binding,
      host: hostForBinding(binding),
      surface: surfaceForCampaignHost(binding),
      isFixedCommitment: !!(chapter?.required || chapter?.hardAnchor),
      environment,
      operationStartedAt: startedAt,
      baselineDormantIdentityKeys: baselineDormant,
      knownLightIdentityKey: anchorKey,
      secondLight:
        isRecovery && dossier
          ? {
              id: `second-light:${dossier.territoryId}`,
              territoryId: dossier.territoryId,
              status: second
                ? ("completed_by_real_customer" as const)
                : ("waiting_for_reality" as const),
              personIdentity: null,
              completedCustomerIdentityKey: second?.identityKey ?? null,
            }
          : null,
    },
    otherOpportunityCount: campaignOthers + recoveryOthers,
    territoryDossiers: dossiers,
  };
}

async function materialize(input: {
  tenantId: string;
  operatorId: string;
  atlas: Atlas;
  campaign: Campaign;
  resolved: {
    campaignTerritoryDefinitionId: string | null;
    lanternCityTerritoryId: string | null;
  };
}): Promise<LanternOperationBaseline> {
  const chapter =
    input.campaign.campaign.chapters.find(
      c => c.stableChapterId === input.campaign.campaign.currentChapterId
    ) ?? null;
  const candidates = AUTHORED_V6_TERRITORY_IDS.map(id => ({
    id,
    customers: input.atlas.customers.filter(
      c =>
        c.location &&
        classifyTerritory(c.location.latitude, c.location.longitude)?.id === id
    ),
  }));
  const fallback = !chapter
    ? candidates
        .filter(x => x.customers.some(c => c.cadence.state === "dark"))
        .sort(
          (a, b) =>
            b.customers.filter(c => c.cadence.state === "dark").length -
              a.customers.filter(c => c.cadence.state === "dark").length ||
            a.id.localeCompare(b.id)
        )[0]
    : null;
  const territoryId = chapter
    ? input.resolved.lanternCityTerritoryId
    : (fallback?.id ?? null);
  const customers = candidates.find(x => x.id === territoryId)?.customers ?? [];
  const type = chapter
    ? chapter.selectedGameplayBinding === "recovery" &&
      !chapter.required &&
      !chapter.hardAnchor &&
      territoryId
      ? "recovery"
      : "campaign"
    : territoryId
      ? "recovery"
      : "explore";
  const stableKey = chapter
    ? `chapter:${chapter.stableChapterId}`
    : `${input.atlas.businessDate}:${type}:${territoryId ?? "city"}`;
  const dormant =
    type === "recovery"
      ? customers
          .filter(c => c.cadence.state === "dark")
          .sort(
            (a, b) =>
              b.cadence.daysSinceLastOrder - a.cadence.daysSinceLastOrder ||
              a.identityKey.localeCompare(b.identityKey)
          )
      : [];
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(goldlineLanternOperations)
    .values({
      id: randomUUID(),
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      stableKey,
      sourceCampaignChapterId: chapter?.stableChapterId ?? null,
      operationType: type,
      campaignTerritoryDefinitionId:
        input.resolved.campaignTerritoryDefinitionId,
      lanternCityTerritoryId: territoryId,
      startedAt: new Date(),
      baselineCustomerIdentityKeysJson: customers.map(c => c.identityKey),
      baselineDormantIdentityKeysJson: dormant.map(c => c.identityKey),
      anchorCustomerIdentityKey: dormant[0]?.identityKey ?? null,
      status: "active",
      metadataJson: { projection: "lantern-city-v6" },
    })
    .onDuplicateKeyUpdate({ set: { stableKey } });
  const [row] = await db
    .select()
    .from(goldlineLanternOperations)
    .where(
      and(
        eq(goldlineLanternOperations.tenantId, input.tenantId),
        eq(goldlineLanternOperations.operatorId, input.operatorId),
        eq(goldlineLanternOperations.stableKey, stableKey)
      )
    )
    .limit(1);
  if (!row) throw new Error("Lantern operation was not materialized");
  return {
    id: row.id,
    stableKey: row.stableKey,
    sourceCampaignChapterId: row.sourceCampaignChapterId,
    operationType:
      row.operationType as LanternOperationBaseline["operationType"],
    campaignTerritoryDefinitionId: row.campaignTerritoryDefinitionId,
    lanternCityTerritoryId: row.lanternCityTerritoryId,
    startedAt: row.startedAt.toISOString(),
    baselineCustomerIdentityKeys:
      row.baselineCustomerIdentityKeysJson as string[],
    baselineDormantIdentityKeys:
      row.baselineDormantIdentityKeysJson as string[],
    anchorCustomerIdentityKey: row.anchorCustomerIdentityKey,
  };
}
function mondayThrough(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return { start: d.toISOString().slice(0, 10), end: date };
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const definitions = await db
    .select({
      id: goldlineTerritoryDefinitions.id,
      realGeographyLabel: goldlineTerritoryDefinitions.realGeographyLabel,
    })
    .from(goldlineTerritoryDefinitions)
    .where(eq(goldlineTerritoryDefinitions.tenantId, input.tenantId));
  const chapter =
    campaign.campaign.chapters.find(
      c => c.stableChapterId === campaign.campaign.currentChapterId
    ) ?? null;
  const resolved = resolveChapterLanternTerritory(chapter, definitions);
  const operation = await materialize({ ...input, atlas, campaign, resolved });
  return projectLanternCityOverview({
    atlas,
    campaign,
    operation,
    resolvedCampaignTerritory: resolved,
    paidRevenueThisWeek: revenue.totalRevenue,
  });
}
