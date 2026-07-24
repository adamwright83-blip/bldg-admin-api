import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialAgreements,
  commercialCustomers,
  commercialFollowUps,
  commercialMissionEvents,
  commercialMissionFinalRewards,
  commercialMissions,
  commercialOrderAttributions,
  commercialPipelineEvents,
  commercialPipelineRecords,
  commercialRouteAssignments,
  commercialServiceExpectations,
  orders,
} from "../../drizzle/schema";
import {
  canAdvanceRelationshipStage,
  type CommercialPipelineStage,
} from "@shared/commercialPipeline";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError as isDuplicateKeyError } from "../mysqlErrors";
import {
  getCommercialMission,
  getCommercialMissionByIdempotencyKey,
  transitionCommercialMission,
} from "../commercialMissions/commercialMissionStore";
import { writeDayforgeEventWith } from "../dayforgeEvents/dayforgeEventStore";

type Transaction = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];

function affectedRows(result: unknown): number {
  return Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
}

function cents(value: string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

function revenueBand(centsValue: number): string {
  if (centsValue < 100_00) return "under_100";
  if (centsValue < 500_00) return "100_to_500";
  if (centsValue < 1_500_00) return "500_to_1500";
  if (centsValue < 5_000_00) return "1500_to_5000";
  return "5000_plus";
}

async function readPipelineWith(
  tx: Transaction,
  input: { tenantId: string; pipelineId: number }
) {
  const rows = await tx
    .select()
    .from(commercialPipelineRecords)
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.id, input.pipelineId)
      )
    )
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

async function readPipeline(input: { tenantId: string; pipelineId: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(commercialPipelineRecords)
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.id, input.pipelineId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function assertPipelineEventPersisted(input: {
  tenantId: string;
  pipelineId: number;
  idempotencyKey: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ pipelineId: commercialPipelineEvents.pipelineId })
    .from(commercialPipelineEvents)
    .where(
      and(
        eq(commercialPipelineEvents.tenantId, input.tenantId),
        eq(commercialPipelineEvents.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  if (!rows[0]) throw new Error("Commercial pipeline event was not persisted");
  if (rows[0].pipelineId !== input.pipelineId)
    throw new Error(
      "Idempotency key is already bound to a different commercial pipeline"
    );
}

async function recalculatePipelineRevenueWith(
  tx: Transaction,
  input: { tenantId: string; missionId: number }
) {
  const totals = await tx
    .select({
      invoiced: sql<number>`COALESCE(SUM(${commercialOrderAttributions.invoicedCents}), 0)`,
      paid: sql<number>`COALESCE(SUM(${commercialOrderAttributions.paidCents}), 0)`,
      realized: sql<number>`COALESCE(SUM(${commercialOrderAttributions.realizedCents}), 0)`,
    })
    .from(commercialOrderAttributions)
    .where(
      and(
        eq(commercialOrderAttributions.tenantId, input.tenantId),
        eq(commercialOrderAttributions.missionId, input.missionId)
      )
    );
  await tx
    .update(commercialPipelineRecords)
    .set({
      invoicedRevenueCents: Number(totals[0]?.invoiced ?? 0),
      paidRevenueCents: Number(totals[0]?.paid ?? 0),
      realizedRevenueCents: Number(totals[0]?.realized ?? 0),
    })
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.missionId, input.missionId)
      )
    );
}

export async function reconcileCommercialPipelineRevenue(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const attributions = await db
    .select()
    .from(commercialOrderAttributions)
    .where(eq(commercialOrderAttributions.tenantId, tenantId));
  if (attributions.length === 0) return { updated: 0 };
  const sourceOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
        inArray(
          orders.id,
          attributions.map(item => item.orderId)
        )
      )
    );
  const byId = new Map(sourceOrders.map(order => [order.id, order]));
  let updated = 0;
  const changedMissions = new Set<number>();
  for (const attribution of attributions) {
    const order = byId.get(attribution.orderId);
    if (!order) continue;
    const paidCents = order.paid ? cents(order.total) : 0;
    const realizedCents = paidCents;
    if (
      attribution.paidCents === paidCents &&
      attribution.realizedCents === realizedCents &&
      attribution.paidAt?.getTime() === order.paidAt?.getTime()
    )
      continue;
    await db.transaction(async tx => {
      const result = await tx
        .update(commercialOrderAttributions)
        .set({
          paidCents,
          realizedCents,
          paidAt: order.paidAt,
        })
        .where(
          and(
            eq(commercialOrderAttributions.tenantId, tenantId),
            eq(commercialOrderAttributions.id, attribution.id),
            eq(
              commercialOrderAttributions.realizedCents,
              attribution.realizedCents
            )
          )
        );
      if (affectedRows(result) !== 1) return;
      if (paidCents > 0) {
        await tx
          .update(commercialServiceExpectations)
          .set({ status: "active" })
          .where(
            and(
              eq(commercialServiceExpectations.tenantId, tenantId),
              eq(
                commercialServiceExpectations.commercialCustomerId,
                attribution.commercialCustomerId
              )
            )
          );
        await tx
          .update(commercialRouteAssignments)
          .set({ status: "active" })
          .where(
            and(
              eq(commercialRouteAssignments.tenantId, tenantId),
              eq(
                commercialRouteAssignments.commercialCustomerId,
                attribution.commercialCustomerId
              )
            )
          );
      }
      await recalculatePipelineRevenueWith(tx, {
        tenantId,
        missionId: attribution.missionId,
      });
      updated += 1;
      changedMissions.add(attribution.missionId);
    });
  }
  return { updated, missionIds: Array.from(changedMissions) };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export async function getCommercialPipelineDetail(input: {
  tenantId: string;
  pipelineId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const pipeline = await readPipeline(input);
  if (!pipeline) return null;
  const mission = await getCommercialMission({
    tenantId: input.tenantId,
    missionId: pipeline.missionId,
  });
  if (!mission) throw new Error("Pipeline mission is missing");
  const [accounts, locations, contacts, events, followUps, customers, rewards] =
    await Promise.all([
      db
        .select()
        .from(commercialAccounts)
        .where(
          and(
            eq(commercialAccounts.tenantId, input.tenantId),
            eq(commercialAccounts.id, pipeline.accountId)
          )
        )
        .limit(1),
      db
        .select()
        .from(commercialAccountLocations)
        .where(
          and(
            eq(commercialAccountLocations.tenantId, input.tenantId),
            eq(commercialAccountLocations.accountId, pipeline.accountId)
          )
        ),
      db
        .select()
        .from(commercialAccountContacts)
        .where(
          and(
            eq(commercialAccountContacts.tenantId, input.tenantId),
            eq(commercialAccountContacts.accountId, pipeline.accountId)
          )
        ),
      db
        .select()
        .from(commercialPipelineEvents)
        .where(
          and(
            eq(commercialPipelineEvents.tenantId, input.tenantId),
            eq(commercialPipelineEvents.pipelineId, pipeline.id)
          )
        )
        .orderBy(
          commercialPipelineEvents.createdAt,
          commercialPipelineEvents.id
        ),
      db
        .select()
        .from(commercialFollowUps)
        .where(
          and(
            eq(commercialFollowUps.tenantId, input.tenantId),
            eq(commercialFollowUps.pipelineId, pipeline.id)
          )
        )
        .orderBy(desc(commercialFollowUps.dueAt)),
      pipeline.commercialCustomerId
        ? db
            .select()
            .from(commercialCustomers)
            .where(
              and(
                eq(commercialCustomers.tenantId, input.tenantId),
                eq(commercialCustomers.id, pipeline.commercialCustomerId)
              )
            )
            .limit(1)
        : Promise.resolve([]),
      db
        .select()
        .from(commercialMissionFinalRewards)
        .where(
          and(
            eq(commercialMissionFinalRewards.tenantId, input.tenantId),
            eq(commercialMissionFinalRewards.missionId, pipeline.missionId)
          )
        )
        .limit(1),
    ]);
  const customer = customers[0] ?? null;
  const [agreements, expectations, routes, orderAttributions] = customer
    ? await Promise.all([
        db
          .select()
          .from(commercialAgreements)
          .where(
            and(
              eq(commercialAgreements.tenantId, input.tenantId),
              eq(commercialAgreements.commercialCustomerId, customer.id)
            )
          ),
        db
          .select()
          .from(commercialServiceExpectations)
          .where(
            and(
              eq(commercialServiceExpectations.tenantId, input.tenantId),
              eq(
                commercialServiceExpectations.commercialCustomerId,
                customer.id
              )
            )
          ),
        db
          .select()
          .from(commercialRouteAssignments)
          .where(
            and(
              eq(commercialRouteAssignments.tenantId, input.tenantId),
              eq(commercialRouteAssignments.commercialCustomerId, customer.id)
            )
          ),
        db
          .select()
          .from(commercialOrderAttributions)
          .where(
            and(
              eq(commercialOrderAttributions.tenantId, input.tenantId),
              eq(commercialOrderAttributions.commercialCustomerId, customer.id)
            )
          )
          .orderBy(commercialOrderAttributions.createdAt),
      ])
    : [[], [], [], []];
  return {
    id: pipeline.id,
    stage: pipeline.stage,
    version: pipeline.version,
    mission,
    account: accounts[0] ?? null,
    locations,
    contacts,
    values: {
      estimatedContractValueCents: pipeline.estimatedContractValueCents,
      approvedContractValueCents: pipeline.approvedContractValueCents,
      invoicedRevenueCents: pipeline.invoicedRevenueCents,
      paidRevenueCents: pipeline.paidRevenueCents,
      realizedRevenueCents: pipeline.realizedRevenueCents,
    },
    nextFollowUpAt: iso(pipeline.nextFollowUpAt),
    lossReason: pipeline.lossReason,
    firstOrderId: pipeline.firstOrderId,
    events: events.map(event => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
    followUps: followUps.map(item => ({
      ...item,
      dueAt: item.dueAt.toISOString(),
      completedAt: iso(item.completedAt),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    customer: customer
      ? {
          ...customer,
          convertedAt: customer.convertedAt.toISOString(),
          createdAt: customer.createdAt.toISOString(),
          updatedAt: customer.updatedAt.toISOString(),
        }
      : null,
    agreements: agreements.map(item => ({
      ...item,
      approvedAt: iso(item.approvedAt),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    serviceExpectations: expectations,
    routeAssignments: routes,
    orderAttributions: orderAttributions.map(item => ({
      ...item,
      paidAt: iso(item.paidAt),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    finalReward: rewards[0]
      ? {
          ...rewards[0],
          awardedAt: rewards[0].awardedAt.toISOString(),
        }
      : null,
  };
}

export async function listCommercialPipeline(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select({
      id: commercialPipelineRecords.id,
      stage: commercialPipelineRecords.stage,
      version: commercialPipelineRecords.version,
      account: {
        id: commercialAccounts.id,
        name: commercialAccounts.name,
        accountType: commercialAccounts.accountType,
      },
      mission: {
        id: commercialMissions.id,
        code: commercialMissions.code,
        status: commercialMissions.status,
        version: commercialMissions.version,
      },
      values: {
        estimatedContractValueCents:
          commercialPipelineRecords.estimatedContractValueCents,
        approvedContractValueCents:
          commercialPipelineRecords.approvedContractValueCents,
        invoicedRevenueCents: commercialPipelineRecords.invoicedRevenueCents,
        paidRevenueCents: commercialPipelineRecords.paidRevenueCents,
        realizedRevenueCents: commercialPipelineRecords.realizedRevenueCents,
      },
      updatedAt: commercialPipelineRecords.updatedAt,
    })
    .from(commercialPipelineRecords)
    .innerJoin(
      commercialAccounts,
      and(
        eq(commercialAccounts.tenantId, tenantId),
        eq(commercialAccounts.id, commercialPipelineRecords.accountId)
      )
    )
    .innerJoin(
      commercialMissions,
      and(
        eq(commercialMissions.tenantId, tenantId),
        eq(commercialMissions.id, commercialPipelineRecords.missionId)
      )
    )
    .where(eq(commercialPipelineRecords.tenantId, tenantId))
    .orderBy(desc(commercialPipelineRecords.updatedAt))
    .limit(250);
}

export async function advanceCommercialRelationshipStage(input: {
  tenantId: string;
  pipelineId: number;
  expectedVersion: number;
  stage: "follow_up" | "proposal_sent" | "pilot_requested" | "verbal_yes";
  actorId: string;
  requestId: string;
  note: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const pipeline = await readPipelineWith(tx, input);
      if (!pipeline) throw new Error("Commercial pipeline record not found");
      const idempotencyKey = `pipeline-relationship:${input.requestId}`;
      const replay = await tx
        .select({ pipelineId: commercialPipelineEvents.pipelineId })
        .from(commercialPipelineEvents)
        .where(
          and(
            eq(commercialPipelineEvents.tenantId, input.tenantId),
            eq(commercialPipelineEvents.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      if (replay[0]) {
        if (replay[0].pipelineId !== pipeline.id)
          throw new Error(
            "Idempotency key is already bound to a different commercial pipeline"
          );
        return;
      }
      const from = pipeline.stage as CommercialPipelineStage;
      if (!canAdvanceRelationshipStage(from, input.stage))
        throw new Error(`Pipeline cannot move from ${from} to ${input.stage}`);
      const result = await tx
        .update(commercialPipelineRecords)
        .set({
          stage: input.stage,
          version: sql`${commercialPipelineRecords.version} + 1`,
        })
        .where(
          and(
            eq(commercialPipelineRecords.tenantId, input.tenantId),
            eq(commercialPipelineRecords.id, input.pipelineId),
            eq(commercialPipelineRecords.version, input.expectedVersion)
          )
        );
      if (affectedRows(result) !== 1)
        throw new Error("Pipeline stage update lost a concurrency race");
      await tx.insert(commercialPipelineEvents).values({
        tenantId: input.tenantId,
        pipelineId: pipeline.id,
        missionId: pipeline.missionId,
        fromStage: from,
        toStage: input.stage,
        actorType: "operator",
        actorId: input.actorId,
        idempotencyKey,
        correlationId: input.requestId,
        metadataJson: { note: input.note, automatic: false },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  await assertPipelineEventPersisted({
    tenantId: input.tenantId,
    pipelineId: input.pipelineId,
    idempotencyKey: `pipeline-relationship:${input.requestId}`,
  });
  const detail = await getCommercialPipelineDetail(input);
  if (!detail) throw new Error("Commercial pipeline record not found");
  return detail;
}

export async function resolveCommercialPipelineMission(input: {
  tenantId: string;
  pipelineId: number;
  expectedMissionVersion: number;
  action: "won" | "lost" | "reopen";
  actorId: string;
  requestId: string;
  reason?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const pipeline = await readPipeline(input);
  if (!pipeline) throw new Error("Commercial pipeline record not found");
  const idempotencyKey = `pipeline-resolution:${input.requestId}`;
  const replay = await getCommercialMissionByIdempotencyKey({
    tenantId: input.tenantId,
    idempotencyKey,
  });
  if (replay) {
    if (replay.id !== pipeline.missionId)
      throw new Error(
        "Idempotency key is already bound to a different commercial mission"
      );
    const detail = await getCommercialPipelineDetail(input);
    if (!detail) throw new Error("Commercial pipeline record not found");
    return detail;
  }
  const mission = await getCommercialMission({
    tenantId: input.tenantId,
    missionId: pipeline.missionId,
  });
  if (!mission) throw new Error("Commercial mission not found");
  const toStatus = input.action === "reopen" ? "selected" : input.action;
  if (input.action === "reopen" && mission.status !== "lost")
    throw new Error("Only a lost mission can be reopened");
  if (
    input.action !== "reopen" &&
    !["visit_completed", "follow_up"].includes(mission.status)
  )
    throw new Error(
      `Mission cannot be marked ${input.action} from ${mission.status}`
    );
  await transitionCommercialMission({
    tenantId: input.tenantId,
    missionId: mission.id,
    expectedVersion: input.expectedMissionVersion,
    toStatus,
    actor: { type: "operator", id: input.actorId },
    idempotencyKey,
    metadata: {
      reason: input.reason ?? null,
      source: "commercial_pipeline",
      requestId: input.requestId,
    },
  });
  const detail = await getCommercialPipelineDetail(input);
  if (!detail) throw new Error("Commercial pipeline record not found");
  return detail;
}

export async function scheduleCommercialFollowUp(input: {
  tenantId: string;
  pipelineId: number;
  actorId: string;
  requestId: string;
  dueAt: Date;
  note: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const pipeline = await readPipelineWith(tx, input);
      if (!pipeline) throw new Error("Commercial pipeline record not found");
      await tx.insert(commercialFollowUps).values({
        id: randomUUID(),
        tenantId: input.tenantId,
        pipelineId: pipeline.id,
        missionId: pipeline.missionId,
        dueAt: input.dueAt,
        note: input.note,
        assignedTo: input.actorId,
        requestId: input.requestId,
        createdBy: input.actorId,
      });
      await tx
        .update(commercialPipelineRecords)
        .set({ nextFollowUpAt: input.dueAt })
        .where(
          and(
            eq(commercialPipelineRecords.tenantId, input.tenantId),
            eq(commercialPipelineRecords.id, pipeline.id)
          )
        );
      await tx.insert(commercialPipelineEvents).values({
        tenantId: input.tenantId,
        pipelineId: pipeline.id,
        missionId: pipeline.missionId,
        fromStage: pipeline.stage,
        toStage: pipeline.stage,
        actorType: "operator",
        actorId: input.actorId,
        idempotencyKey: `pipeline-follow-up:${input.requestId}`,
        correlationId: input.requestId,
        metadataJson: {
          dueAt: input.dueAt.toISOString(),
          note: input.note,
        },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const detail = await getCommercialPipelineDetail(input);
  if (!detail?.followUps.some(item => item.requestId === input.requestId))
    throw new Error("Commercial follow-up was not persisted for this request");
  return detail;
}

export async function completeCommercialFollowUp(input: {
  tenantId: string;
  pipelineId: number;
  followUpId: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const pipeline = await readPipelineWith(tx, input);
      if (!pipeline) throw new Error("Commercial pipeline record not found");
      const idempotencyKey = `pipeline-follow-up-completed:${input.requestId}`;
      const replay = await tx
        .select({ pipelineId: commercialPipelineEvents.pipelineId })
        .from(commercialPipelineEvents)
        .where(
          and(
            eq(commercialPipelineEvents.tenantId, input.tenantId),
            eq(commercialPipelineEvents.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      if (replay[0]) {
        if (replay[0].pipelineId !== pipeline.id)
          throw new Error(
            "Idempotency key is already bound to a different commercial pipeline"
          );
        return;
      }
      const result = await tx
        .update(commercialFollowUps)
        .set({
          status: "completed",
          completedAt: new Date(),
          completedBy: input.actorId,
        })
        .where(
          and(
            eq(commercialFollowUps.tenantId, input.tenantId),
            eq(commercialFollowUps.pipelineId, input.pipelineId),
            eq(commercialFollowUps.id, input.followUpId),
            eq(commercialFollowUps.status, "open")
          )
        );
      if (affectedRows(result) !== 1)
        throw new Error("Open follow-up not found or already completed");
      await tx.insert(commercialPipelineEvents).values({
        tenantId: input.tenantId,
        pipelineId: pipeline.id,
        missionId: pipeline.missionId,
        fromStage: pipeline.stage,
        toStage: pipeline.stage,
        actorType: "operator",
        actorId: input.actorId,
        idempotencyKey,
        correlationId: input.requestId,
        metadataJson: { followUpId: input.followUpId },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  await assertPipelineEventPersisted({
    tenantId: input.tenantId,
    pipelineId: input.pipelineId,
    idempotencyKey: `pipeline-follow-up-completed:${input.requestId}`,
  });
  const detail = await getCommercialPipelineDetail(input);
  if (
    !detail?.followUps.some(
      item => item.id === input.followUpId && item.status === "completed"
    )
  )
    throw new Error("Commercial follow-up completion was not persisted");
  return detail;
}

export async function rescheduleCommercialFollowUp(input: {
  tenantId: string;
  pipelineId: number;
  followUpId: string;
  actorId: string;
  requestId: string;
  dueAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const pipeline = await readPipelineWith(tx, input);
    if (!pipeline) throw new Error("Commercial pipeline record not found");
    const existing = await tx.select({ id: commercialPipelineEvents.id }).from(commercialPipelineEvents).where(and(
      eq(commercialPipelineEvents.tenantId, input.tenantId),
      eq(commercialPipelineEvents.idempotencyKey, `pipeline-follow-up-rescheduled:${input.requestId}`)
    )).limit(1);
    if (existing[0]) return;
    const result = await tx.update(commercialFollowUps).set({ dueAt: input.dueAt }).where(and(
      eq(commercialFollowUps.tenantId, input.tenantId),
      eq(commercialFollowUps.pipelineId, input.pipelineId),
      eq(commercialFollowUps.id, input.followUpId),
      eq(commercialFollowUps.status, "open")
    ));
    if (affectedRows(result) !== 1) throw new Error("Open follow-up not found");
    await tx.update(commercialPipelineRecords).set({ nextFollowUpAt: input.dueAt }).where(and(
      eq(commercialPipelineRecords.tenantId, input.tenantId),
      eq(commercialPipelineRecords.id, input.pipelineId)
    ));
    await tx.insert(commercialPipelineEvents).values({
      tenantId: input.tenantId, pipelineId: input.pipelineId, missionId: pipeline.missionId,
      fromStage: pipeline.stage, toStage: pipeline.stage, actorType: "operator",
      actorId: input.actorId, idempotencyKey: `pipeline-follow-up-rescheduled:${input.requestId}`,
      correlationId: input.requestId,
      metadataJson: { followUpId: input.followUpId, dueAt: input.dueAt.toISOString() },
    });
  });
  const detail = await getCommercialPipelineDetail(input);
  if (!detail) throw new Error("Commercial pipeline record not found");
  return detail;
}

export async function approveCommercialAgreement(input: {
  tenantId: string;
  pipelineId: number;
  actorId: string;
  requestId: string;
  approvedAnnualValueCents: number;
  evidenceReference: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const pipeline = await readPipelineWith(tx, input);
      if (
        !pipeline ||
        pipeline.stage !== "won" ||
        !pipeline.commercialCustomerId
      )
        throw new Error("Only a won converted account can record an agreement");
      const agreement = await tx
        .select()
        .from(commercialAgreements)
        .where(
          and(
            eq(commercialAgreements.tenantId, input.tenantId),
            eq(commercialAgreements.missionId, pipeline.missionId)
          )
        )
        .for("update")
        .limit(1);
      if (!agreement[0])
        throw new Error("Commercial agreement record not found");
      await tx
        .update(commercialAgreements)
        .set({
          status: "approved",
          approvedAnnualValueCents: input.approvedAnnualValueCents,
          evidenceReference: input.evidenceReference,
          recordedBy: input.actorId,
          approvedAt: new Date(),
        })
        .where(
          and(
            eq(commercialAgreements.tenantId, input.tenantId),
            eq(commercialAgreements.id, agreement[0].id)
          )
        );
      await tx
        .update(commercialCustomers)
        .set({ approvedAnnualValueCents: input.approvedAnnualValueCents })
        .where(
          and(
            eq(commercialCustomers.tenantId, input.tenantId),
            eq(commercialCustomers.id, pipeline.commercialCustomerId)
          )
        );
      await tx
        .update(commercialServiceExpectations)
        .set({ status: "approved", approvedAt: new Date() })
        .where(
          and(
            eq(commercialServiceExpectations.tenantId, input.tenantId),
            eq(
              commercialServiceExpectations.commercialCustomerId,
              pipeline.commercialCustomerId
            )
          )
        );
      await tx
        .update(commercialPipelineRecords)
        .set({ approvedContractValueCents: input.approvedAnnualValueCents })
        .where(
          and(
            eq(commercialPipelineRecords.tenantId, input.tenantId),
            eq(commercialPipelineRecords.id, pipeline.id)
          )
        );
      await tx.insert(commercialPipelineEvents).values({
        tenantId: input.tenantId,
        pipelineId: pipeline.id,
        missionId: pipeline.missionId,
        fromStage: "won",
        toStage: "won",
        actorType: "operator",
        actorId: input.actorId,
        idempotencyKey: `pipeline-agreement:${input.requestId}`,
        correlationId: input.requestId,
        metadataJson: {
          approvedAnnualValueCents: input.approvedAnnualValueCents,
          evidenceReference: input.evidenceReference,
        },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  await assertPipelineEventPersisted({
    tenantId: input.tenantId,
    pipelineId: input.pipelineId,
    idempotencyKey: `pipeline-agreement:${input.requestId}`,
  });
  const detail = await getCommercialPipelineDetail(input);
  if (!detail) throw new Error("Commercial pipeline record not found");
  return detail;
}

export async function attributeCommercialOrder(input: {
  tenantId: string;
  pipelineId: number;
  orderId: number;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const pipeline = await readPipelineWith(tx, input);
      if (
        !pipeline ||
        pipeline.stage !== "won" ||
        !pipeline.commercialCustomerId
      )
        throw new Error("Only a won converted account can receive orders");
      const sourceOrders = await tx
        .select()
        .from(orders)
        .where(
          and(
            sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`,
            eq(orders.id, input.orderId)
          )
        )
        .for("update")
        .limit(1);
      const order = sourceOrders[0];
      if (!order) throw new Error("Tenant order not found");
      const firstOrder = pipeline.firstOrderId === null;
      const paidCents = order.paid ? cents(order.total) : 0;
      await tx.insert(commercialOrderAttributions).values({
        tenantId: input.tenantId,
        commercialCustomerId: pipeline.commercialCustomerId,
        missionId: pipeline.missionId,
        orderId: order.id,
        attributionType: firstOrder ? "first_order" : "recurring",
        invoicedCents: 0,
        paidCents,
        realizedCents: paidCents,
        paidAt: order.paidAt,
        requestId: input.requestId,
        createdBy: input.actorId,
      });
      if (firstOrder) {
        await tx
          .update(commercialCustomers)
          .set({ firstOrderId: order.id })
          .where(
            and(
              eq(commercialCustomers.tenantId, input.tenantId),
              eq(commercialCustomers.id, pipeline.commercialCustomerId)
            )
          );
        await tx
          .update(commercialPipelineRecords)
          .set({ firstOrderId: order.id })
          .where(
            and(
              eq(commercialPipelineRecords.tenantId, input.tenantId),
              eq(commercialPipelineRecords.id, pipeline.id)
            )
          );
      }
      if (paidCents > 0) {
        await tx
          .update(commercialServiceExpectations)
          .set({ status: "active" })
          .where(
            and(
              eq(commercialServiceExpectations.tenantId, input.tenantId),
              eq(
                commercialServiceExpectations.commercialCustomerId,
                pipeline.commercialCustomerId
              )
            )
          );
        await tx
          .update(commercialRouteAssignments)
          .set({ status: "active" })
          .where(
            and(
              eq(commercialRouteAssignments.tenantId, input.tenantId),
              eq(
                commercialRouteAssignments.commercialCustomerId,
                pipeline.commercialCustomerId
              )
            )
          );
      }
      await recalculatePipelineRevenueWith(tx, {
        tenantId: input.tenantId,
        missionId: pipeline.missionId,
      });
      const refreshedPipelineRows = await tx
        .select()
        .from(commercialPipelineRecords)
        .where(
          and(
            eq(commercialPipelineRecords.tenantId, input.tenantId),
            eq(commercialPipelineRecords.id, pipeline.id)
          )
        )
        .limit(1);
      const refreshedPipeline = refreshedPipelineRows[0];
      if (!refreshedPipeline)
        throw new Error("Commercial pipeline disappeared during attribution");
      await tx.insert(commercialMissionEvents).values({
        tenantId: input.tenantId,
        missionId: pipeline.missionId,
        eventName: firstOrder
          ? "first_order_attributed"
          : "recurring_order_attributed",
        fromStatus: "won",
        toStatus: "won",
        actorType: "operator",
        actorId: input.actorId,
        idempotencyKey: `commercial-order:${input.requestId}`,
        metadataJson: {
          orderId: order.id,
          paidRevenueCents: paidCents,
          realizedRevenueCents: paidCents,
          invoicedRevenueCents: 0,
          invoiceEvidenceAvailable: false,
        },
      });
      await tx.insert(commercialPipelineEvents).values({
        tenantId: input.tenantId,
        pipelineId: pipeline.id,
        missionId: pipeline.missionId,
        fromStage: "won",
        toStage: "won",
        actorType: "operator",
        actorId: input.actorId,
        idempotencyKey: `pipeline-order:${input.requestId}`,
        correlationId: input.requestId,
        metadataJson: {
          orderId: order.id,
          attributionType: firstOrder ? "first_order" : "recurring",
          paidRevenueCents: paidCents,
        },
      });
      if (paidCents > 0) {
        const projectionCorrelationId = `commercial-pipeline:${pipeline.id}:order:${input.requestId}`;
        await writeDayforgeEventWith(tx, {
          tenantId: input.tenantId,
          actor: { type: "operator", id: input.actorId },
          entityType: "commercial_pipeline",
          entityId: String(pipeline.id),
          eventName: "revenue_realized",
          before: {
            missionId: pipeline.missionId,
            accountId: pipeline.accountId,
            customerId: pipeline.commercialCustomerId,
            paidRevenueCents: pipeline.paidRevenueCents,
            realizedRevenueCents: pipeline.realizedRevenueCents,
          },
          after: {
            missionId: refreshedPipeline.missionId,
            accountId: refreshedPipeline.accountId,
            customerId: refreshedPipeline.commercialCustomerId,
            paidRevenueCents: refreshedPipeline.paidRevenueCents,
            realizedRevenueCents: refreshedPipeline.realizedRevenueCents,
          },
          source: "commercial_pipeline",
          correlationId: projectionCorrelationId,
          idempotencyKey: `${projectionCorrelationId}:revenue_realized`,
          productEvent: {
            name: "revenue_realized",
            missionId: pipeline.missionId,
            accountId: pipeline.accountId,
            opportunityId: pipeline.opportunityId,
            customerId: pipeline.commercialCustomerId,
            properties: {
              revenueBand: revenueBand(paidCents),
              attributionConfidence: "provider_paid_order",
            },
          },
        });
      }
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const detail = await getCommercialPipelineDetail(input);
  if (
    !detail?.orderAttributions.some(
      item =>
        item.orderId === input.orderId && item.requestId === input.requestId
    )
  )
    throw new Error(
      "Commercial order attribution was not persisted for this request"
    );
  return detail;
}
