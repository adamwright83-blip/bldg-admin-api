import type { BusinessEvent, VerificationClass } from "../../shared/businessGame";

type CommonEventRow = {
  tenantId: string;
  createdAt: Date;
  actorId?: string | null;
  metadataJson?: unknown;
};

function payload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function event(input: Omit<BusinessEvent, "occurredAt"> & { occurredAt: Date }): BusinessEvent {
  return { ...input, occurredAt: input.occurredAt.toISOString() };
}

export function orderPaymentEventToBusinessEvent(row: CommonEventRow & {
  id: string;
  orderId: number;
  provider: string;
  providerEventId: string | null;
  eventType: string;
  occurredAt: Date;
  requestId: string;
  capturedCents?: number | null;
  refundedCents?: number | null;
  netPaidCents?: number | null;
}): BusinessEvent {
  const verificationClass: VerificationClass = row.providerEventId ? "VERIFIED" : "ATTESTED";
  return event({
    id: `payment:${row.id}`,
    tenantId: row.tenantId,
    entityType: "order",
    entityId: String(row.orderId),
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    actorType: row.providerEventId ? "provider" : "system",
    actorId: null,
    source: row.provider,
    sourceReference: row.providerEventId ?? row.requestId,
    verificationClass,
    confidence: row.providerEventId ? "high" : "medium",
    idempotencyKey: row.providerEventId ? `${row.provider}:${row.providerEventId}` : row.requestId,
    payload: {
      capturedCents: row.capturedCents ?? null,
      refundedCents: row.refundedCents ?? null,
      netPaidCents: row.netPaidCents ?? null,
    },
  });
}

export function missionEventToBusinessEvent(row: CommonEventRow & {
  id: number;
  missionId: number;
  eventName: string;
  actorType: "system" | "operator" | "driver" | "game";
  idempotencyKey: string;
  fromStatus?: string | null;
  toStatus?: string | null;
}): BusinessEvent {
  return event({
    id: `mission:${row.id}`,
    tenantId: row.tenantId,
    entityType: "commercial_mission",
    entityId: String(row.missionId),
    eventType: row.eventName,
    occurredAt: row.createdAt,
    actorType: row.actorType === "driver" ? "field" : row.actorType === "game" ? "system" : row.actorType,
    actorId: row.actorId ?? null,
    source: "commercial_mission_events",
    sourceReference: `commercial_mission_events:${row.id}`,
    verificationClass: row.actorType === "system" || row.actorType === "game" ? "VERIFIED" : "ATTESTED",
    confidence: "high",
    idempotencyKey: row.idempotencyKey,
    payload: { ...payload(row.metadataJson), fromStatus: row.fromStatus ?? null, toStatus: row.toStatus ?? null },
  });
}

export function commercialFollowUpToBusinessEvent(row: CommonEventRow & {
  id: string;
  missionId: number;
  pipelineId: number;
  status: string;
  requestId: string;
  dueAt: Date;
  completedAt?: Date | null;
  completedBy?: string | null;
}): BusinessEvent {
  const completed = row.status === "completed" && row.completedAt;
  return event({
    id: `follow-up:${row.id}:${completed ? "completed" : "scheduled"}`,
    tenantId: row.tenantId,
    entityType: "commercial_follow_up",
    entityId: row.id,
    eventType: completed ? "commercial_follow_up_completed" : "commercial_follow_up_scheduled",
    occurredAt: completed ? row.completedAt! : row.createdAt,
    actorType: completed ? "operator" : "system",
    actorId: completed ? row.completedBy ?? null : row.actorId ?? null,
    source: "commercial_follow_ups",
    sourceReference: `commercial_follow_ups:${row.id}`,
    verificationClass: completed ? "ATTESTED" : "VERIFIED",
    confidence: "high",
    idempotencyKey: `${row.requestId}:${completed ? "completed" : "scheduled"}`,
    payload: { missionId: row.missionId, pipelineId: row.pipelineId, dueAt: row.dueAt.toISOString() },
  });
}

export function visitOutcomeToBusinessEvent(row: CommonEventRow & {
  id: number;
  missionId: number;
  outcome: string;
  recordedBy: string;
  evidenceJson: unknown;
  estimatedContractValueCents?: number | null;
}): BusinessEvent {
  const evidence = payload(row.evidenceJson);
  const independentlyVerified = evidence.verificationClass === "verified" || evidence.gpsVerified === true;
  return event({
    id: `visit:${row.id}`,
    tenantId: row.tenantId,
    entityType: "commercial_mission",
    entityId: String(row.missionId),
    eventType: `visit_${row.outcome}`,
    occurredAt: row.createdAt,
    actorType: "field",
    actorId: row.recordedBy,
    source: "commercial_visit_outcomes",
    sourceReference: `commercial_visit_outcomes:${row.id}`,
    verificationClass: independentlyVerified ? "VERIFIED" : "ATTESTED",
    confidence: independentlyVerified ? "high" : "medium",
    idempotencyKey: `visit-outcome:${row.tenantId}:${row.missionId}`,
    payload: { outcome: row.outcome, estimatedContractValueCents: row.estimatedContractValueCents ?? null, evidence },
  });
}

export function journalEventToBusinessEvent(row: CommonEventRow & {
  id: string;
  driverId: string;
  journalDate: string;
  journalPoints: number;
  processingStatus: string;
}): BusinessEvent {
  return event({
    id: `journal:${row.id}`,
    tenantId: row.tenantId,
    entityType: "sales_journal",
    entityId: row.id,
    eventType: "sales_journal_saved",
    occurredAt: row.createdAt,
    actorType: "field",
    actorId: row.driverId,
    source: "driver_sales_journals",
    sourceReference: `driver_sales_journals:${row.id}`,
    verificationClass: "ATTESTED",
    confidence: "medium",
    idempotencyKey: `journal:${row.tenantId}:${row.driverId}:${row.journalDate}`,
    payload: { journalDate: row.journalDate, journalPoints: row.journalPoints, processingStatus: row.processingStatus },
  });
}
