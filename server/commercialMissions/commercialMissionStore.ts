import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialMissionEvents,
  commercialMissions,
  commercialMissionSteps,
  commercialOpportunities,
  opsTaskEvents,
  opsTasks,
  type CommercialMissionRow,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  formatMissionCode,
  type CommercialMission,
  type CommercialMissionAccountSnapshot,
  type CommercialMissionBrief,
  type CommercialMissionOpportunitySnapshot,
  type CommercialMissionStatus,
  type CommercialMissionStep,
} from "@shared/commercialMission";
import { eventNameForCommercialMissionTransition } from "@shared/commercialMissionLifecycle";
import {
  commercialAccountIdentityKey,
  commercialContactIdentityKey,
  commercialLocationIdentityKey,
  createCommercialPipelineForMissionWith,
  syncCommercialPipelineForMissionTransitionWith,
} from "../commercialPipeline/commercialPipelineCore";
import {
  writeDayforgeEventWith,
  type DayforgeServerActor,
} from "../dayforgeEvents/dayforgeEventStore";

type Actor = {
  type: "system" | "operator" | "driver" | "game";
  id: string | null;
};

function dayforgeActor(actor: Actor): DayforgeServerActor {
  return {
    type: actor.type === "driver" ? "field" : actor.type,
    id: actor.id,
  };
}

function missionProjectionCorrelationId(missionId: number, requestKey: string): string {
  const requestHash = createHash("sha256").update(requestKey).digest("hex").slice(0, 32);
  return `commercial-mission:${missionId}:${requestHash}`;
}

function missionAuditSnapshot(mission: CommercialMission) {
  return {
    missionId: mission.id,
    missionCode: mission.code,
    accountId: mission.account.accountId,
    opportunityId: mission.opportunity.opportunityId,
    assignedTo: mission.assignedTo,
    status: mission.status,
    version: mission.version,
    estimatedAnnualValueCents: mission.opportunity.estimatedAnnualValueCents,
    estimateConfidence: mission.opportunity.estimateConfidence,
    score: mission.opportunity.score,
  };
}

function productEventForMissionLifecycle(input: {
  eventName: string;
  metadata?: Record<string, unknown>;
}) {
  switch (input.eventName) {
    case "mission_created": return "mission_created" as const;
    case "game_started":
      return input.metadata?.retry === true
        ? "mission_game_retried" as const
        : "mission_game_started" as const;
    case "game_abandoned": return "mission_game_abandoned" as const;
    case "game_completed": return "mission_game_completed" as const;
    case "phone_unlocked": return "mission_phone_unlocked" as const;
    case "preparation_started": return "field_preparation_started" as const;
    case "departed": return "field_departed" as const;
    case "arrived": return "field_arrived" as const;
    case "visit_completed": return "visit_completed" as const;
    case "follow_up_required": return "follow_up_created" as const;
    case "account_won": return "account_won" as const;
    case "account_lost": return "account_lost" as const;
    default: return null;
  }
}

function sourceForMissionLifecycle(eventName: string): string {
  if (eventName.startsWith("game_") || eventName === "phone_unlocked") return "boreslay";
  if (["preparation_started", "departed", "arrived", "visit_completed", "follow_up_required"].includes(eventName)) {
    return "dayforge_field";
  }
  return "commercial_mission";
}

function estimatedValueBand(cents: number): string {
  if (cents < 5_000_00) return "under_5k";
  if (cents < 15_000_00) return "5k_to_15k";
  if (cents < 30_000_00) return "15k_to_30k";
  if (cents < 75_000_00) return "30k_to_75k";
  return "75k_plus";
}

function numericMetadata(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function productPropertiesForMissionLifecycle(input: {
  productEventName: NonNullable<ReturnType<typeof productEventForMissionLifecycle>>;
  mission: CommercialMission;
  metadata?: Record<string, unknown>;
}) {
  const valueBand = estimatedValueBand(input.mission.opportunity.estimatedAnnualValueCents);
  switch (input.productEventName) {
    case "mission_created":
      return { missionKind: "commercial_acquisition", sourceKind: "dayforge_radar", estimatedValueBand: valueBand };
    case "mission_game_started":
      return { attemptNumber: numericMetadata(input.metadata, "attemptNumber"), gameMode: "boreslay_commercial_mission" };
    case "mission_game_abandoned":
      return {
        attemptNumber: numericMetadata(input.metadata, "attemptNumber"),
        durationMs: numericMetadata(input.metadata, "durationMs"),
        abandonmentReasonCode: stringMetadata(input.metadata, "reason") ?? "recovered_by_retry",
      };
    case "mission_game_retried":
      return { attemptNumber: numericMetadata(input.metadata, "attemptNumber"), priorOutcome: "abandoned" };
    case "mission_game_completed":
      return {
        attemptNumber: numericMetadata(input.metadata, "attemptNumber"),
        durationMs: numericMetadata(input.metadata, "durationMs"),
        outcome: "qualified",
      };
    case "mission_phone_unlocked":
      return { unlockSource: "qualifying_game_result", attemptNumber: numericMetadata(input.metadata, "attemptNumber") };
    case "field_preparation_started":
      return {
        resume: false,
        checklistItemCount: Array.isArray(input.metadata?.checklistItemKeys)
          ? input.metadata.checklistItemKeys.length
          : undefined,
      };
    case "field_departed": return { navigationMode: "operator_selected" };
    case "field_arrived": return { arrivalMethod: stringMetadata(input.metadata, "checkInMethod") };
    case "visit_completed":
      return {
        outcome: stringMetadata(input.metadata, "visitOutcome") ?? "recorded",
        proofKind: input.metadata?.collateralDelivered === true ? "collateral_delivered" : "operator_attestation",
      };
    case "follow_up_created": {
      const followUpAt = stringMetadata(input.metadata, "followUpAt");
      const dueInDays = followUpAt
        ? Math.max(0, Math.ceil((Date.parse(followUpAt) - Date.now()) / 86_400_000))
        : undefined;
      return { followUpKind: "field_visit", dueInDays };
    }
    case "account_won": return { sourceKind: "field_visit", estimatedValueBand: valueBand };
    case "account_lost":
      return { sourceKind: "field_visit", lossReasonCode: stringMetadata(input.metadata, "reason") ?? "not_recorded" };
  }
}

function affectedRows(result: unknown): number {
  return Number((result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0);
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; errno?: number };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

function asDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function decodeMission(row: CommercialMissionRow, steps: CommercialMissionStep[]): CommercialMission {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    status: row.status,
    version: row.version,
    assignedTo: row.assignedTo,
    opsTaskId: row.opsTaskId,
    account: row.accountSnapshotJson as CommercialMissionAccountSnapshot,
    opportunity: row.opportunitySnapshotJson as CommercialMissionOpportunitySnapshot,
    brief: row.missionBriefJson as CommercialMissionBrief,
    steps,
    expiresAt: asDate(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: asDate(row.completedAt),
  };
}

export type CommercialMissionTransaction = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];

export async function readCommercialMissionWith(
  query: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">,
  input: { tenantId: string; missionId: number },
): Promise<CommercialMission | null> {
  const rows = await query
    .select()
    .from(commercialMissions)
    .where(and(eq(commercialMissions.tenantId, input.tenantId), eq(commercialMissions.id, input.missionId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const stepRows = await query
    .select()
    .from(commercialMissionSteps)
    .where(and(eq(commercialMissionSteps.tenantId, input.tenantId), eq(commercialMissionSteps.missionId, input.missionId)))
    .orderBy(commercialMissionSteps.position);
  return decodeMission(
    row,
    stepRows.map(step => ({
      key: step.stepKey,
      label: step.label,
      detail: step.detail,
      status: step.status,
      position: step.position,
    })),
  );
}

export async function createCommercialMission(input: {
  tenantId: string;
  assignedTo?: string | null;
  account: Omit<CommercialMissionAccountSnapshot, "accountId">;
  opportunity: Omit<CommercialMissionOpportunitySnapshot, "opportunityId">;
  brief: CommercialMissionBrief;
  steps: CommercialMissionStep[];
  actor: Actor;
  idempotencyKey: string;
}): Promise<CommercialMission> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    return await db.transaction(async tx => {
      const existingEvent = await tx
        .select({ missionId: commercialMissionEvents.missionId })
        .from(commercialMissionEvents)
        .where(and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(commercialMissionEvents.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (existingEvent[0]) {
        const existing = await readCommercialMissionWith(tx, {
          tenantId: input.tenantId,
          missionId: existingEvent[0].missionId,
        });
        if (!existing) throw new Error("Idempotent commercial mission result is missing");
        return existing;
      }

      const identityKey = commercialAccountIdentityKey(input.account);
      await tx.insert(commercialAccounts).values({
        tenantId: input.tenantId,
        identityKey,
        name: input.account.name,
        accountType: input.account.accountType,
        providerName: input.account.providerName ?? null,
        providerAccountId: input.account.providerAccountId ?? null,
      }).onDuplicateKeyUpdate({ set: {
        identityKey,
        name: input.account.name,
        accountType: input.account.accountType,
        providerName: input.account.providerName ?? null,
        providerAccountId: input.account.providerAccountId ?? null,
      }});
      const accountRows = await tx.select({ id: commercialAccounts.id }).from(commercialAccounts).where(and(
        eq(commercialAccounts.tenantId, input.tenantId),
        eq(commercialAccounts.identityKey, identityKey),
      )).limit(1);
      const accountId = accountRows[0]?.id;
      if (!accountId) throw new Error("Commercial account identity was not persisted");
      await tx.insert(commercialAccountLocations).values({
        tenantId: input.tenantId,
        accountId,
        locationKey: commercialLocationIdentityKey(input.account),
        label: "Primary",
        address: input.account.address,
        latitude: String(input.account.latitude),
        longitude: String(input.account.longitude),
        isPrimary: true,
      }).onDuplicateKeyUpdate({ set: {
        address: input.account.address,
        latitude: String(input.account.latitude),
        longitude: String(input.account.longitude),
        isPrimary: true,
      }});
      if (input.account.decisionMaker.name || input.account.decisionMaker.title) {
        await tx.insert(commercialAccountContacts).values({
          tenantId: input.tenantId,
          accountId,
          contactKey: commercialContactIdentityKey(input.account.decisionMaker),
          name: input.account.decisionMaker.name,
          title: input.account.decisionMaker.title,
        }).onDuplicateKeyUpdate({ set: {
          name: input.account.decisionMaker.name,
          title: input.account.decisionMaker.title,
        }});
      }
      const opportunityInsert = await tx.insert(commercialOpportunities).values({
        tenantId: input.tenantId,
        accountId,
        score: input.opportunity.score,
        grade: input.opportunity.estimateConfidence,
        estimatedAnnualValueCents: input.opportunity.estimatedAnnualValueCents,
        estimateConfidence: input.opportunity.estimateConfidence,
        primarySignal: input.opportunity.primarySignal,
        reasonsJson: input.opportunity.reasons,
        risksJson: input.opportunity.risks,
        evidenceJson: [],
      });
      const opportunityId = Number(opportunityInsert[0].insertId);
      const accountSnapshot: CommercialMissionAccountSnapshot = { ...input.account, accountId };
      const opportunitySnapshot: CommercialMissionOpportunitySnapshot = {
        ...input.opportunity,
        opportunityId,
      };

      const taskInsert = await tx.insert(opsTasks).values({
        tenantId: input.tenantId,
        lane: "level_4",
        level: "4",
        taskType: "gm_followup",
        title: `Commercial opportunity · ${input.account.name}`,
        description: input.brief.laundryOpportunity,
        source: "agent_suggested",
        createdBy: input.actor.id ?? "dayforge-radar",
        assignedTo: input.assignedTo ?? null,
        status: "open",
        priority: input.opportunity.estimateConfidence === "high" ? "high" : "normal",
        revenueAtRiskCents: input.opportunity.estimatedAnnualValueCents,
        revenueRecoveredCents: 0,
      });
      const opsTaskId = Number(taskInsert[0].insertId);
      const temporaryCode = `PENDING-${crypto.randomUUID().slice(0, 12)}`;
      const missionInsert = await tx.insert(commercialMissions).values({
        tenantId: input.tenantId,
        opportunityId,
        opsTaskId,
        assignedTo: input.assignedTo ?? null,
        code: temporaryCode,
        status: "candidate",
        version: 1,
        accountSnapshotJson: accountSnapshot,
        opportunitySnapshotJson: opportunitySnapshot,
        missionBriefJson: input.brief,
        createdBy: input.actor.id ?? "dayforge-radar",
      });
      const missionId = Number(missionInsert[0].insertId);
      const code = formatMissionCode(missionId);
      await tx
        .update(commercialMissions)
        .set({ code })
        .where(and(eq(commercialMissions.tenantId, input.tenantId), eq(commercialMissions.id, missionId)));

      await createCommercialPipelineForMissionWith(tx, {
        tenantId: input.tenantId,
        accountId,
        opportunityId,
        missionId,
        estimatedContractValueCents: input.opportunity.estimatedAnnualValueCents,
        actor: input.actor,
        correlationId: input.idempotencyKey,
      });

      if (input.steps.length > 0) {
        await tx.insert(commercialMissionSteps).values(
          input.steps.map(step => ({
            tenantId: input.tenantId,
            missionId,
            stepKey: step.key,
            label: step.label,
            detail: step.detail,
            status: step.status,
            position: step.position,
          })),
        );
      }

      await tx.insert(commercialMissionEvents).values({
        tenantId: input.tenantId,
        missionId,
        eventName: "mission_created",
        fromStatus: null,
        toStatus: "candidate",
        actorType: input.actor.type,
        actorId: input.actor.id,
        idempotencyKey: input.idempotencyKey,
        metadataJson: { opsTaskId, opportunityId, accountId },
      });
      await tx.insert(opsTaskEvents).values({
        tenantId: input.tenantId,
        taskId: opsTaskId,
        eventType: "agent_suggested",
        actorType: input.actor.type === "driver" ? "driver" : input.actor.type === "operator" ? "human" : "system",
        actorId: input.actor.id,
        afterJson: { commercialMissionId: missionId, code },
        note: `${code} created for ${input.account.name}`,
      });

      const created = await readCommercialMissionWith(tx, { tenantId: input.tenantId, missionId });
      if (!created) throw new Error("Commercial mission insert did not return a row");
      const projectionCorrelationId = missionProjectionCorrelationId(missionId, input.idempotencyKey);
      await writeDayforgeEventWith(tx, {
        tenantId: input.tenantId,
        actor: dayforgeActor(input.actor),
        entityType: "commercial_mission",
        entityId: String(missionId),
        eventName: "mission_created",
        before: null,
        after: missionAuditSnapshot(created),
        source: "commercial_mission",
        correlationId: projectionCorrelationId,
        idempotencyKey: `${projectionCorrelationId}:mission_created`,
        productEvent: {
          name: "mission_created",
          missionId,
          accountId,
          opportunityId,
          properties: {
            missionKind: "commercial_acquisition",
            sourceKind: input.idempotencyKey.startsWith("public-preview:")
              ? "public_territory_preview"
              : "dayforge_radar",
            estimatedValueBand: estimatedValueBand(created.opportunity.estimatedAnnualValueCents),
          },
        },
      });
      if (created.assignedTo) {
        await writeDayforgeEventWith(tx, {
          tenantId: input.tenantId,
          actor: dayforgeActor(input.actor),
          entityType: "commercial_mission",
          entityId: String(missionId),
          eventName: "mission_assigned",
          before: { assignedTo: null },
          after: { assignedTo: created.assignedTo, version: created.version },
          source: "commercial_mission",
          correlationId: projectionCorrelationId,
          idempotencyKey: `${projectionCorrelationId}:mission_assigned`,
          productEvent: {
            name: "mission_assigned",
            missionId,
            accountId,
            opportunityId,
            properties: { assigneeRole: "field", assignmentSource: "mission_creation" },
          },
        });
      }
      return created;
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const replay = await getCommercialMissionByIdempotencyKey({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!replay) throw error;
    return replay;
  }
}

export async function getCommercialMission(input: {
  tenantId: string;
  missionId: number;
}): Promise<CommercialMission | null> {
  const db = await getDb();
  if (!db) return null;
  return readCommercialMissionWith(db, input);
}

export async function listCommercialMissions(input: {
  tenantId: string;
  assignedTo?: string;
  limit?: number;
}): Promise<CommercialMission[]> {
  const db = await getDb();
  if (!db) return [];
  const where = input.assignedTo
    ? and(eq(commercialMissions.tenantId, input.tenantId), eq(commercialMissions.assignedTo, input.assignedTo))
    : eq(commercialMissions.tenantId, input.tenantId);
  const rows = await db
    .select({ id: commercialMissions.id })
    .from(commercialMissions)
    .where(where)
    .orderBy(desc(commercialMissions.updatedAt), desc(commercialMissions.id))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 250));
  const missions = await Promise.all(rows.map(row => readCommercialMissionWith(db, {
    tenantId: input.tenantId,
    missionId: row.id,
  })));
  return missions.filter((mission): mission is CommercialMission => mission !== null);
}

export async function getCommercialMissionByIdempotencyKey(input: {
  tenantId: string;
  idempotencyKey: string;
}): Promise<CommercialMission | null> {
  const db = await getDb();
  if (!db) return null;
  const events = await db
    .select({ missionId: commercialMissionEvents.missionId })
    .from(commercialMissionEvents)
    .where(and(
      eq(commercialMissionEvents.tenantId, input.tenantId),
      eq(commercialMissionEvents.idempotencyKey, input.idempotencyKey),
    ))
    .limit(1);
  if (!events[0]) return null;
  return getCommercialMission({ tenantId: input.tenantId, missionId: events[0].missionId });
}

export async function transitionCommercialMission(input: {
  tenantId: string;
  missionId: number;
  expectedVersion: number;
  toStatus: CommercialMissionStatus;
  actor: Actor;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<CommercialMission> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    return await db.transaction(tx => transitionCommercialMissionWith(tx, input));
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const replay = await getCommercialMissionByIdempotencyKey({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!replay || replay.id !== input.missionId) throw error;
    return replay;
  }
}

export async function transitionCommercialMissionWith(
  tx: CommercialMissionTransaction,
  input: {
    tenantId: string;
    missionId: number;
    expectedVersion: number;
    toStatus: CommercialMissionStatus;
    actor: Actor;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  },
): Promise<CommercialMission> {
      const replayEvent = await tx
        .select({ missionId: commercialMissionEvents.missionId })
        .from(commercialMissionEvents)
        .where(and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(commercialMissionEvents.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (replayEvent[0]) {
        if (replayEvent[0].missionId !== input.missionId) {
          throw new Error("Idempotency key is already bound to a different commercial mission");
        }
        const replay = await readCommercialMissionWith(tx, { tenantId: input.tenantId, missionId: replayEvent[0].missionId });
        if (!replay) throw new Error("Idempotent transition result is missing");
        return replay;
      }

      const current = await readCommercialMissionWith(tx, input);
      if (!current) throw new Error("Commercial mission not found");
      if (current.version !== input.expectedVersion) {
        throw new Error(`Commercial mission version conflict: expected ${input.expectedVersion}, found ${current.version}`);
      }
      const eventName = eventNameForCommercialMissionTransition(current.status, input.toStatus);
      await tx.insert(commercialMissionEvents).values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        eventName,
        fromStatus: current.status,
        toStatus: input.toStatus,
        actorType: input.actor.type,
        actorId: input.actor.id,
        idempotencyKey: input.idempotencyKey,
        metadataJson: input.metadata,
      });
      const terminal = input.toStatus === "won" || input.toStatus === "lost";
      const update = await tx
        .update(commercialMissions)
        .set({
          status: input.toStatus,
          version: sql`${commercialMissions.version} + 1`,
          completedAt: terminal ? new Date() : null,
        })
        .where(and(
          eq(commercialMissions.tenantId, input.tenantId),
          eq(commercialMissions.id, input.missionId),
          eq(commercialMissions.version, input.expectedVersion),
          eq(commercialMissions.status, current.status),
        ));
      if (affectedRows(update) !== 1) throw new Error("Commercial mission transition lost an optimistic concurrency race");

      if (current.opsTaskId) {
        await tx.update(opsTasks).set({
          status: terminal ? "completed" : input.toStatus === "candidate" || input.toStatus === "selected" || input.toStatus === "game_ready" ? "open" : "in_progress",
          completedAt: terminal ? new Date() : null,
          completedBy: terminal ? input.actor.id : null,
          outcome: input.toStatus === "won" ? `Account won: ${current.account.name}` : input.toStatus === "lost" ? `Account lost: ${current.account.name}` : null,
          metadataJson: { commercialMissionId: current.id, commercialMissionStatus: input.toStatus },
        }).where(and(eq(opsTasks.tenantId, input.tenantId), eq(opsTasks.id, current.opsTaskId)));
      }

      await syncCommercialPipelineForMissionTransitionWith(tx, {
        tenantId: input.tenantId,
        mission: current,
        toStatus: input.toStatus,
        actor: input.actor,
        correlationId: input.idempotencyKey,
        metadata: input.metadata,
      });

      const transitioned = await readCommercialMissionWith(tx, input);
      if (!transitioned) throw new Error("Commercial mission transition did not return a row");
      const productEventName = productEventForMissionLifecycle({ eventName, metadata: input.metadata });
      const projectionCorrelationId = missionProjectionCorrelationId(input.missionId, input.idempotencyKey);
      await writeDayforgeEventWith(tx, {
        tenantId: input.tenantId,
        actor: dayforgeActor(input.actor),
        entityType: "commercial_mission",
        entityId: String(input.missionId),
        eventName,
        before: missionAuditSnapshot(current),
        after: missionAuditSnapshot(transitioned),
        source: sourceForMissionLifecycle(eventName),
        correlationId: projectionCorrelationId,
        idempotencyKey: `${projectionCorrelationId}:${eventName}`,
        productEvent: productEventName
          ? {
              name: productEventName,
              missionId: input.missionId,
              accountId: transitioned.account.accountId,
              opportunityId: transitioned.opportunity.opportunityId,
              properties: productPropertiesForMissionLifecycle({
                productEventName,
                mission: transitioned,
                metadata: input.metadata,
              }),
            }
          : undefined,
      });
      return transitioned;
}

export async function listCommercialMissionEvents(input: {
  tenantId: string;
  missionId: number;
}) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(commercialMissionEvents)
    .where(and(
      eq(commercialMissionEvents.tenantId, input.tenantId),
      eq(commercialMissionEvents.missionId, input.missionId),
    ))
    .orderBy(commercialMissionEvents.createdAt, commercialMissionEvents.id);
}
