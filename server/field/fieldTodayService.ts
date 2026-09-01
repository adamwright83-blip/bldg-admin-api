import { asc, sql } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import { deterministicEstimate, sourcedFact } from "../../shared/businessGame";
import { getDb } from "../db";
import { listDayforgeToday } from "../dayforgeToday/dayforgeTodayService";
import type { FieldTodayItem, FieldTodayProjection } from "./types";
import { listRecoveryInterventions, physicalEntityIdsForInterventions } from "../churnRadar/customerChurnService";
import { listForgeJobs } from "../worldForge/worldForgeService";

function moneyCents(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function businessDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function timeFromWindow(date: string, window: string | null): string | null {
  const match = window?.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hour < 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  const value = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

const urgencyRank: Record<FieldTodayItem["urgency"], number> = {
  blocked: 0, overdue: 1, urgent: 2, scheduled: 3, flexible: 4, upcoming: 5,
};

export function sortFieldTimeline(items: FieldTodayItem[]): FieldTodayItem[] {
  const unique = Array.from(new Map(items.map(item => [item.id, item])).values());
  return unique.sort((a, b) => {
    const rank = urgencyRank[a.urgency] - urgencyRank[b.urgency];
    if (rank) return rank;
    const time = (a.scheduledAt ? Date.parse(a.scheduledAt) : Number.MAX_SAFE_INTEGER)
      - (b.scheduledAt ? Date.parse(b.scheduledAt) : Number.MAX_SAFE_INTEGER);
    return time || a.id.localeCompare(b.id);
  });
}

export async function getFieldToday(input: {
  tenantId: string;
  userId: string;
  includeAllAssignees: boolean;
  now?: Date;
  timeZone?: string;
}): Promise<FieldTodayProjection> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const date = businessDate(now, timeZone);
  const [orderRows, commercialItems, recoveries, forgeJobs] = await Promise.all([
    db.select().from(orders).where(sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId} AND (${orders.pickupDate} = ${date} OR ${orders.deliveryDate} = ${date})`).orderBy(asc(orders.pickupDate), asc(orders.id)),
    listDayforgeToday({ tenantId: input.tenantId, userId: input.userId, includeAllAssignees: input.includeAllAssignees }),
    listRecoveryInterventions(input.tenantId),
    listForgeJobs({ tenantId: input.tenantId, limit: 50 }),
  ]);
  const timeline: FieldTodayItem[] = [];
  for (const order of orderRows) {
    const name = `${order.firstName} ${order.lastName}`.trim() || "Customer";
    if (order.pickupDate === date && ["new", "intake-pending"].includes(order.status)) {
      timeline.push({
        id: `pickup:${order.id}`, kind: "pickup", source: { entityType: "order", entityId: String(order.id), sourceReference: `orders:${order.id}` },
        scheduledAt: timeFromWindow(order.pickupDate, order.pickupTimeWindow), urgency: "scheduled", title: `Pick up ${name}`, subtitle: order.serviceType === "wash_fold" ? "Laundry pickup" : "Dry-cleaning pickup", status: order.status,
        destination: { address: order.address, latitude: null, longitude: null }, customer: { name, phone: order.phone, email: order.email },
        money: deterministicEstimate(moneyCents(order.total), `orders:${order.id}:total`, "high"), verificationClass: "VERIFIED",
        actions: [{ type: "navigate", label: "Navigate", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`, mutation: null }, { type: "start", label: "Mark collected", href: null, mutation: "admin.updateStatus:collected" }],
      });
    }
    if (order.deliveryDate === date && order.status === "ready") {
      const unpaid = !order.paid;
      timeline.push({
        id: `${unpaid ? "payment-blocker" : "delivery"}:${order.id}`, kind: unpaid ? "payment_blocker" : "delivery",
        source: { entityType: "order", entityId: String(order.id), sourceReference: `orders:${order.id}` },
        scheduledAt: timeFromWindow(order.deliveryDate, order.deliveryTimeWindow), urgency: unpaid ? "blocked" : "scheduled", title: unpaid ? `Payment blocks ${name}'s delivery` : `Deliver to ${name}`,
        subtitle: unpaid ? "This order is ready but not paid. It cannot be presented as completed." : "Paid order ready for delivery", status: order.status,
        destination: { address: order.address, latitude: null, longitude: null }, customer: { name, phone: order.phone, email: order.email },
        money: sourcedFact(moneyCents(order.total), `orders:${order.id}`), verificationClass: "VERIFIED",
        actions: unpaid
          ? [{ type: "payment", label: "Resolve payment", href: `/payment-reconciliation?orderId=${order.id}`, mutation: null }]
          : [{ type: "navigate", label: "Navigate", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`, mutation: null }, { type: "complete", label: "Mark delivered", href: null, mutation: "admin.updateStatus:delivered" }],
      });
    }
  }
  for (const item of commercialItems) {
    timeline.push({
      id: item.id,
      kind: item.kind === "dispatch" ? "mission_dispatch" : item.kind === "follow_up" ? "follow_up" : "route_exception",
      source: { entityType: item.kind === "follow_up" ? "commercial_follow_up" : "commercial_mission", entityId: item.followUpId ?? String(item.missionId), sourceReference: item.kind === "follow_up" ? `commercial_follow_ups:${item.followUpId}` : `commercial_missions:${item.missionId}` },
      scheduledAt: item.dueAt, urgency: item.urgency === "overdue" ? "overdue" : item.urgency === "urgent" ? "urgent" : item.urgency === "upcoming" ? "upcoming" : "flexible",
      title: item.accountName, subtitle: item.note ?? item.missionCode, status: item.status,
      destination: item.address ? { address: item.address, latitude: null, longitude: null } : null,
      customer: { name: item.accountName, phone: item.phone, email: item.email },
      money: item.estimatedValueCents == null ? null : deterministicEstimate(item.estimatedValueCents, `commercial_pipeline_records:${item.pipelineId}`, "medium"),
      verificationClass: "VERIFIED",
      actions: [{ type: "open", label: "Open", href: item.destinationPath, mutation: null }],
    });
  }
  const openRecoveries = recoveries.filter(item =>
    ["draft_pending_review", "approved", "contacted"].includes(item.status)
  );
  // Recovery work is placed at the building the dormant customer actually
  // orders from, so entering it from the day lands on the same save file.
  const recoveryEntities = await physicalEntityIdsForInterventions(
    input.tenantId,
    openRecoveries.map(item => item.id)
  );
  for (const recovery of openRecoveries) {
    timeline.push({
      id: `recovery:${recovery.id}`, kind: "customer_recovery",
      source: { entityType: "customer_recovery_intervention", entityId: recovery.id, sourceReference: `customer_recovery_interventions:${recovery.id}` },
      physicalEntityId: recoveryEntities.get(recovery.id) ?? null,
      scheduledAt: null, urgency: recovery.status === "approved" ? "urgent" : "flexible",
      title: `Recovery · ${recovery.customer.customerName}`,
      subtitle: recovery.status === "contacted" ? "Signal sent; awaiting authoritative customer activity" : recovery.customer.recommendedAction,
      status: recovery.status, destination: null,
      customer: { name: recovery.customer.customerName, phone: null, email: null },
      money: deterministicEstimate(recovery.customer.estimatedMonthlyImpactCents, `customer_churn_snapshots:${recovery.customer.id}`, recovery.customer.confidence),
      verificationClass: "VERIFIED",
      actions: [{ type: "open", label: "Enter Recovery Path", href: recoveryEntities.get(recovery.id) ? `/growth/lantern-city?entity=${recoveryEntities.get(recovery.id)}` : "/growth/lantern-city", mutation: null }],
    });
  }
  for (const forge of forgeJobs.filter(job => ["review_ready", "generation_unconfigured", "published"].includes(job.state))) {
    timeline.push({
      id: `forge:${forge.id}`, kind: "contextual_move",
      source: { entityType: "tower_forge_job", entityId: forge.id, sourceReference: `tower_forge_jobs:${forge.id}` },
      physicalEntityId: forge.physicalEntityId ?? null,
      scheduledAt: null, urgency: forge.state === "review_ready" ? "urgent" : "flexible",
      title: forge.state === "published" ? "Published tower in Lantern City" : forge.state === "review_ready" ? "New tower discovered" : "Tower Forge awaiting art",
      subtitle: forge.state.replaceAll("_", " "), status: forge.state, destination: null, customer: null, money: null,
      verificationClass: "VERIFIED",
      actions: [{ type: "open", label: "Reveal in world", href: forge.physicalEntityId ? `/growth/lantern-city?entity=${forge.physicalEntityId}` : "/tower-forge", mutation: null }],
    });
  }
  const sorted = sortFieldTimeline(timeline);
  const nextFixedCommitment = sorted
    .filter(item => item.scheduledAt && Date.parse(item.scheduledAt) >= now.getTime() && ["pickup", "delivery", "job"].includes(item.kind))
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))[0] ?? null;
  return {
    generatedAt: now.toISOString(), businessDate: date, currentUserId: input.userId, timeline: sorted,
    nextFixedCommitment, blockers: sorted.filter(item => item.urgency === "blocked"),
    dataQuality: { status: "partial", warnings: ["Laundry order addresses do not currently contain verified coordinates", "Travel duration is unavailable until live routing is configured"], sources: ["orders", "commercial_follow_ups", "commercial_mission_dispatches", "commercial_pipeline_records", "customer_recovery_interventions", "tower_forge_jobs"] },
  };
}
