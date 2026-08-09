import { createHash, randomUUID } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import {
  businessDayResolutions,
  commercialMissionEvents,
  customerRecoveryEvents,
  driverSalesJournals,
  operationsEvents,
  orderPaymentEvents,
} from "../../drizzle/schema";
import { dedupeBusinessEvents } from "../../shared/businessGame";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import { missionEventToBusinessEvent, orderPaymentEventToBusinessEvent } from "../businessEvents/businessEventAdapters";
import { getFieldToday } from "../field/fieldTodayService";
import type { DayResolution } from "./unloadTypes";

function rangeForDate(date: string, timeZone: string) {
  const start = fromZonedTime(`${date}T00:00:00`, timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const nextLabel = new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
  const next = fromZonedTime(`${nextLabel}T00:00:00`, timeZone);
  return { start, next };
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function resolveDay(input: { tenantId: string; actorId: string; businessDate: string; requestId: string; timeZone?: string; now?: Date }): Promise<DayResolution> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select().from(businessDayResolutions).where(and(eq(businessDayResolutions.tenantId, input.tenantId), eq(businessDayResolutions.businessDate, input.businessDate), eq(businessDayResolutions.actorId, input.actorId))).limit(1);
  if (existing) return existing.resolutionJson as DayResolution;
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const { start, next } = rangeForDate(input.businessDate, timeZone);
  const now = input.now ?? new Date();
  const [work, payments, missions, recoveries, journals, tomorrow] = await Promise.all([
    db.select().from(operationsEvents).where(and(eq(operationsEvents.tenantId, input.tenantId), gte(operationsEvents.actualEventTimestamp, start), lt(operationsEvents.actualEventTimestamp, next))),
    db.select().from(orderPaymentEvents).where(and(eq(orderPaymentEvents.tenantId, input.tenantId), gte(orderPaymentEvents.occurredAt, start), lt(orderPaymentEvents.occurredAt, next))),
    db.select().from(commercialMissionEvents).where(and(eq(commercialMissionEvents.tenantId, input.tenantId), gte(commercialMissionEvents.createdAt, start), lt(commercialMissionEvents.createdAt, next))),
    db.select().from(customerRecoveryEvents).where(and(eq(customerRecoveryEvents.tenantId, input.tenantId), gte(customerRecoveryEvents.createdAt, start), lt(customerRecoveryEvents.createdAt, next))),
    db.select().from(driverSalesJournals).where(and(eq(driverSalesJournals.tenantId, input.tenantId), eq(driverSalesJournals.driverId, input.actorId), eq(driverSalesJournals.journalDate, input.businessDate))).limit(1),
    getFieldToday({ tenantId: input.tenantId, userId: input.actorId, includeAllAssignees: true, now: new Date(next.getTime() + 8 * 60 * 60 * 1000), timeZone }),
  ]);
  const paymentBusinessEvents = payments.map(orderPaymentEventToBusinessEvent);
  const missionBusinessEvents = missions.map(missionEventToBusinessEvent);
  const relationshipEvents = dedupeBusinessEvents(missionBusinessEvents.filter(event => /visit|follow_up|won|lost/.test(event.eventType)));
  const journal = journals[0];
  const draft: Omit<DayResolution, "id"> = {
    tenantId: input.tenantId, businessDate: input.businessDate, sourceThrough: now.toISOString(),
    completedWork: work.filter(event => event.eventStatus === "completed").map(event => ({ id: `operations:${event.id}`, title: `${event.sourceEventType === "pickup_completed" ? "Pickup" : "Dropoff"} completed for ${event.customerName}`, sourceReference: `operations_events:${event.id}` })),
    moneyEvents: paymentBusinessEvents.map(event => ({ id: event.id, title: event.eventType.replace(/_/g," "), amountCents: typeof event.payload.netPaidCents === "number" ? event.payload.netPaidCents : null, verificationClass: event.verificationClass, sourceReference: event.sourceReference })),
    relationshipEvents,
    commercialEvents: dedupeBusinessEvents(missionBusinessEvents),
    recoveryEvents: recoveries.map(event => ({ id: `recovery:${event.id}`, title: event.eventName.replace(/_/g," "), sourceReference: `customer_recovery_events:${event.id}` })),
    journal: { status: journal ? "saved" : "not_saved", journalPoints: journal?.journalPoints ?? 0, sourceReference: journal ? `driver_sales_journals:${journal.id}` : null },
    worldDeltas: [
      ...work.filter(event => event.eventStatus === "completed").map(event => ({ id: `work:${event.id}`, title: `${event.customerName}: ${event.sourceEventType.replace(/_/g," ")}`, verificationClass: "VERIFIED" as const, sourceReference: `operations_events:${event.id}` })),
      ...paymentBusinessEvents.map(event => ({ id: event.id, title: `Verified collection for order ${event.entityId}`, verificationClass: event.verificationClass, sourceReference: event.sourceReference })),
      ...relationshipEvents.map(event => ({ id: event.id, title: event.eventType.replace(/_/g," "), verificationClass: event.verificationClass, sourceReference: event.sourceReference })),
    ],
    tomorrowState: { itemCount: tomorrow.timeline.length, blockerCount: tomorrow.blockers.length },
    motivationalAwards: journal?.journalPoints ? [{ type: "journal_points", points: journal.journalPoints, sourceReference: `driver_sales_journals:${journal.id}` }] : [],
    dataQuality: { status: "trusted", warnings: journal ? [] : ["No sales journal was saved for this day"], sources: ["operations_events", "order_payment_events", "commercial_mission_events", "customer_recovery_events", "driver_sales_journals"] },
  };
  const resolution: DayResolution = { id: randomUUID(), ...draft };
  const row = { id: resolution.id, tenantId: input.tenantId, businessDate: input.businessDate, actorId: input.actorId, requestId: input.requestId, sourceThrough: now, contentHash: stableHash(draft), resolutionJson: resolution };
  try {
    await db.insert(businessDayResolutions).values(row);
    return resolution;
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const [replay] = await db.select().from(businessDayResolutions).where(and(eq(businessDayResolutions.tenantId, input.tenantId), eq(businessDayResolutions.businessDate, input.businessDate), eq(businessDayResolutions.actorId, input.actorId))).limit(1);
    if (!replay) throw error;
    return replay.resolutionJson as DayResolution;
  }
}
