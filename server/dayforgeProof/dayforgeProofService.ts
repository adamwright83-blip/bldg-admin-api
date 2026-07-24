import { and, eq, gte, lt } from "drizzle-orm";
import {
  commercialAccounts, commercialCampaignLinks, commercialFollowUps,
  commercialMissionDispatches, commercialMissionEvents,
  commercialOrderAcquisitionAttributions, commercialOrderAttributions,
  commercialPipelineRecords,
} from "../../drizzle/schema";
import { getDb } from "../db";

export function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

export async function getDayforgeProofDashboard(input: { tenantId: string; start: Date; end: Date }) {
  const db = await getDb(); if (!db) throw new Error("Database not available");
  const [events, followUps, pipelines, dispatches, revenue] = await Promise.all([
    db.select().from(commercialMissionEvents).where(and(eq(commercialMissionEvents.tenantId, input.tenantId), gte(commercialMissionEvents.createdAt, input.start), lt(commercialMissionEvents.createdAt, input.end))),
    db.select().from(commercialFollowUps).where(and(eq(commercialFollowUps.tenantId, input.tenantId), gte(commercialFollowUps.createdAt, input.start), lt(commercialFollowUps.createdAt, input.end))),
    db.select({ id: commercialPipelineRecords.id, missionId: commercialPipelineRecords.missionId, stage: commercialPipelineRecords.stage, estimated: commercialPipelineRecords.estimatedContractValueCents, accountId: commercialAccounts.id, accountName: commercialAccounts.name })
      .from(commercialPipelineRecords).innerJoin(commercialAccounts, and(eq(commercialAccounts.tenantId, input.tenantId), eq(commercialAccounts.id, commercialPipelineRecords.accountId))).where(and(eq(commercialPipelineRecords.tenantId, input.tenantId), gte(commercialPipelineRecords.createdAt, input.start), lt(commercialPipelineRecords.createdAt, input.end))),
    db.select().from(commercialMissionDispatches).where(and(eq(commercialMissionDispatches.tenantId, input.tenantId), gte(commercialMissionDispatches.createdAt, input.start), lt(commercialMissionDispatches.createdAt, input.end))),
    db.select({
      attributionId: commercialOrderAttributions.id, orderId: commercialOrderAttributions.orderId,
      missionId: commercialOrderAttributions.missionId, attributionType: commercialOrderAttributions.attributionType,
      status: commercialOrderAttributions.status, realized: commercialOrderAttributions.realizedCents,
      paidAt: commercialOrderAttributions.paidAt, acquisitionId: commercialOrderAcquisitionAttributions.id,
      campaignId: commercialCampaignLinks.id, campaignName: commercialCampaignLinks.campaignName,
      placement: commercialCampaignLinks.placement, collateralVersion: commercialCampaignLinks.collateralVersion,
      salespersonId: commercialCampaignLinks.salespersonId, referringContactId: commercialCampaignLinks.referringContactId,
      accountId: commercialAccounts.id, accountName: commercialAccounts.name,
    }).from(commercialOrderAttributions)
      .leftJoin(commercialOrderAcquisitionAttributions, and(eq(commercialOrderAcquisitionAttributions.tenantId, input.tenantId), eq(commercialOrderAcquisitionAttributions.id, commercialOrderAttributions.acquisitionAttributionId)))
      .leftJoin(commercialCampaignLinks, and(eq(commercialCampaignLinks.tenantId, input.tenantId), eq(commercialCampaignLinks.id, commercialOrderAcquisitionAttributions.orderCampaignLinkId)))
      .innerJoin(commercialPipelineRecords, and(eq(commercialPipelineRecords.tenantId, input.tenantId), eq(commercialPipelineRecords.missionId, commercialOrderAttributions.missionId)))
      .innerJoin(commercialAccounts, and(eq(commercialAccounts.tenantId, input.tenantId), eq(commercialAccounts.id, commercialPipelineRecords.accountId)))
      .where(and(eq(commercialOrderAttributions.tenantId, input.tenantId), gte(commercialOrderAttributions.createdAt, input.start), lt(commercialOrderAttributions.createdAt, input.end))),
  ]);
  const count = (name: string) => events.filter(event => event.eventName === name).length;
  const now = new Date();
  const activeRevenue = revenue.filter(item => item.status === "active" && item.paidAt && item.realized > 0);
  const sum = (items: typeof activeRevenue) => items.reduce((total, item) => total + item.realized, 0);
  const group = (key: "accountName" | "campaignName" | "placement" | "salespersonId") => Object.entries(activeRevenue.reduce<Record<string, number>>((map, item) => {
    const label = String(item[key] ?? "Unspecified"); map[label] = (map[label] ?? 0) + item.realized; return map;
  }, {})).map(([label, realizedCents]) => ({ label, realizedCents })).sort((a, b) => b.realizedCents - a.realizedCents);
  const nonTerminal = pipelines.filter(item => !["won", "lost"].includes(item.stage));
  const withNext = new Set(followUps.filter(item => item.status === "open").map(item => item.missionId));
  return {
    range: { start: input.start.toISOString(), end: input.end.toISOString() },
    activity: {
      prospectsAdded: count("mission_created"), walkInsLogged: count("unplanned_walk_in"),
      plannedMissionsCreated: count("irl_plan_created"), gamesStarted: count("game_started"),
      gamesCompleted: count("game_completed"), gameBypasses: count("unplanned_walk_in"),
      fieldVisitsAttempted: count("visit_completed"), decisionMakersReached: events.filter(event => (event.metadataJson as any)?.decisionMakerStatus === "met").length,
      contactsCaptured: events.filter(event => event.eventName === "unplanned_walk_in" && Boolean((event.metadataJson as any)?.contact)).length,
      collateralDelivered: events.filter(event => (event.metadataJson as any)?.collateralDelivered === true).length,
      followUpsDue: followUps.filter(item => item.status === "open").length,
      followUpsCompleted: followUps.filter(item => item.status === "completed").length,
      overdueFollowUps: followUps.filter(item => item.status === "open" && item.dueAt < now).length,
    },
    conversion: {
      proposalsRequested: events.filter(event => (event.metadataJson as any)?.quoteRequested === true).length,
      pilotsRequested: events.filter(event => (event.metadataJson as any)?.pilotRequested === true).length,
      accountsWon: pipelines.filter(item => item.stage === "won").length,
      accountsLost: pipelines.filter(item => item.stage === "lost").length,
      firstPaidOrders: activeRevenue.filter(item => item.attributionType === "first_order").length,
      recurringPaidOrders: activeRevenue.filter(item => item.attributionType === "recurring").length,
    },
    money: {
      paidFirstOrderRevenueCents: sum(activeRevenue.filter(item => item.attributionType === "first_order")),
      paidRecurringRevenueCents: sum(activeRevenue.filter(item => item.attributionType === "recurring")),
      realizedAttributedRevenueCents: sum(activeRevenue),
      estimatedPipelineCents: pipelines.reduce((total, item) => total + (item.estimated ?? 0), 0),
      byProperty: group("accountName"), byCampaign: group("campaignName"), byPlacement: group("placement"), bySalesperson: group("salespersonId"),
    },
    productProof: {
      missionsWithNextAction: nonTerminal.filter(item => withNext.has(item.missionId)).length,
      nextActionCompliancePercent: percentage(nonTerminal.filter(item => withNext.has(item.missionId)).length, nonTerminal.length),
      dispatchOpenRatePercent: percentage(dispatches.filter(item => item.status === "opened").length, dispatches.filter(item => item.channel === "in_app").length),
    },
    drillDown: pipelines.map(item => ({ pipelineId: item.id, missionId: item.missionId, accountId: item.accountId, accountName: item.accountName, stage: item.stage })),
  };
}
