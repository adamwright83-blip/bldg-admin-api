/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, eq, sql } from "drizzle-orm";
import type { CommercialMission } from "@shared/commercialMission";
import {
  directCompletionIdempotencyKey,
  directPathLedger,
  missionNeedsSameFieldDispatch,
  missionOffersBothCompletionPaths,
  objectiveForCompletionPath,
  type DirectCompletionMetadata,
  type PlayOfferStatus,
} from "@shared/missionCompletionPath";
import {
  commercialMissionEvents,
  commercialMissions,
  opsTasks,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import { syncCommercialPipelineForMissionTransitionWith } from "../domains/commercial/commercialPipelineCore";
import { dispatchCommercialMission } from "./commercialMissionDispatchService";

export type DirectMissionActor = {
  type: "operator" | "driver";
  id: string;
};

export type DirectCompletionResult = {
  missionId: number;
  objectiveStatus: "phone_ready";
  pipelineStage: "field_ready";
  worldVisualState: "active";
  completionPath: "direct";
  awardsXp: false;
  awardsStreak: false;
  replayed: boolean;
  dispatched: boolean;
};

type LockedMission = {
  id: number;
  version: number;
  status: CommercialMission["status"];
  opsTaskId: number | null;
  opportunityId: number | null;
};

export type DirectCompletionWrite = {
  tenantId: string;
  expectedVersion: number;
  fromStatus: PlayOfferStatus;
  actor: DirectMissionActor;
  idempotencyKey: string;
  metadata: DirectCompletionMetadata;
  opsTaskId: number | null;
  mission: CommercialMission;
};

export type DirectCompletionTransaction = {
  readMission(input: {
    tenantId: string;
    missionId: number;
  }): Promise<LockedMission | null>;
  findEvent(input: {
    tenantId: string;
    idempotencyKey: string;
  }): Promise<{ missionId: number } | null>;
  write(input: DirectCompletionWrite): Promise<void>;
};

export type DirectCompletionRepository = {
  transaction<T>(
    work: (tx: DirectCompletionTransaction) => Promise<T>
  ): Promise<T>;
};

type DispatchDirectCompletion = (input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  requestId: string;
  dispatchPolicy: "on_game_complete";
  includeSms: false;
}) => Promise<unknown>;

function affectedRows(result: unknown): number {
  return Number((result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0);
}

function directMetadata(from: PlayOfferStatus): DirectCompletionMetadata {
  const [event] = directPathLedger(from);
  return event?.metadata as DirectCompletionMetadata;
}

function result(input: {
  missionId: number;
  replayed: boolean;
  dispatched: boolean;
}): DirectCompletionResult {
  const objective = objectiveForCompletionPath("direct");
  return {
    missionId: input.missionId,
    objectiveStatus: objective.status,
    pipelineStage: objective.pipelineStage,
    worldVisualState: objective.worldVisualState,
    completionPath: "direct",
    awardsXp: false,
    awardsStreak: false,
    replayed: input.replayed,
    dispatched: input.dispatched,
  };
}

export async function completeDirectMissionPathWith(
  repository: DirectCompletionRepository,
  input: {
    tenantId: string;
    mission: CommercialMission;
    expectedVersion: number;
    requestId: string;
    actor: DirectMissionActor;
  },
  deps: { dispatch: DispatchDirectCompletion }
): Promise<DirectCompletionResult> {
  const idempotencyKey = directCompletionIdempotencyKey(input.requestId);
  const outcome = await repository.transaction(async tx => {
    const existing = await tx.findEvent({
      tenantId: input.tenantId,
      idempotencyKey,
    });
    if (existing) {
      if (existing.missionId !== input.mission.id) {
        throw new Error("Idempotency key is already bound to a different commercial mission");
      }
      return "replay" as const;
    }
    const locked = await tx.readMission({
      tenantId: input.tenantId,
      missionId: input.mission.id,
    });
    if (!locked) throw new Error("Commercial mission not found");
    if (!missionOffersBothCompletionPaths(locked.status)) {
      throw new Error(
        `This mission cannot be completed directly from ${locked.status}`
      );
    }
    if (locked.version !== input.expectedVersion) {
      throw new Error(
        `Commercial mission version conflict: expected ${input.expectedVersion}, found ${locked.version}`
      );
    }
    if (!locked.opportunityId) {
      throw new Error("Commercial mission is missing its opportunity identity");
    }
    await tx.write({
      tenantId: input.tenantId,
      expectedVersion: input.expectedVersion,
      fromStatus: locked.status,
      actor: input.actor,
      idempotencyKey,
      metadata: directMetadata(locked.status),
      opsTaskId: locked.opsTaskId,
      mission: input.mission,
    });
    return "written" as const;
  });

  let dispatched = false;
  if (missionNeedsSameFieldDispatch(input.mission)) {
    await deps.dispatch({
      tenantId: input.tenantId,
      missionId: input.mission.id,
      actorId: input.actor.id,
      requestId: input.requestId,
      dispatchPolicy: "on_game_complete",
      includeSms: false,
    });
    dispatched = true;
  }
  return result({
    missionId: input.mission.id,
    replayed: outcome === "replay",
    dispatched,
  });
}

type MissionDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type MissionTx = Parameters<Parameters<MissionDb["transaction"]>[0]>[0];

function drizzleTransaction(
  tx: MissionTx,
  mission: CommercialMission
): DirectCompletionTransaction {
  return {
    async readMission(input) {
      const [row] = await tx
        .select({
          id: commercialMissions.id,
          version: commercialMissions.version,
          status: commercialMissions.status,
          opsTaskId: commercialMissions.opsTaskId,
          opportunityId: commercialMissions.opportunityId,
        })
        .from(commercialMissions)
        .where(
          and(
            eq(commercialMissions.tenantId, input.tenantId),
            eq(commercialMissions.id, input.missionId)
          )
        )
        .limit(1);
      return row ?? null;
    },
    async findEvent(input) {
      const [row] = await tx
        .select({ missionId: commercialMissionEvents.missionId })
        .from(commercialMissionEvents)
        .where(
          and(
            eq(commercialMissionEvents.tenantId, input.tenantId),
            eq(commercialMissionEvents.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      return row ?? null;
    },
    async write(input) {
      try {
        await tx.insert(commercialMissionEvents).values({
          tenantId: input.tenantId,
          missionId: input.mission.id,
          eventName: "direct_objective_completed",
          fromStatus: input.fromStatus,
          toStatus: "phone_ready",
          actorType: input.actor.type,
          actorId: input.actor.id,
          idempotencyKey: input.idempotencyKey,
          metadataJson: input.metadata,
        });
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        const [row] = await tx
          .select({ missionId: commercialMissionEvents.missionId })
          .from(commercialMissionEvents)
          .where(
            and(
              eq(commercialMissionEvents.tenantId, input.tenantId),
              eq(commercialMissionEvents.idempotencyKey, input.idempotencyKey)
            )
          )
          .limit(1);
        if (row?.missionId === input.mission.id) return;
        throw error;
      }
      const update = await tx
        .update(commercialMissions)
        .set({
          status: "phone_ready",
          version: sql`${commercialMissions.version} + 1`,
        })
        .where(
          and(
            eq(commercialMissions.tenantId, input.tenantId),
            eq(commercialMissions.id, input.mission.id),
            eq(commercialMissions.version, input.expectedVersion),
            eq(commercialMissions.status, input.fromStatus)
          )
        );
      if (affectedRows(update) !== 1) {
        throw new Error("Commercial mission transition lost an optimistic concurrency race");
      }
      if (input.opsTaskId) {
        await tx
          .update(opsTasks)
          .set({
            status: "in_progress",
            completedAt: null,
            completedBy: null,
            outcome: null,
            metadataJson: {
              commercialMissionId: input.mission.id,
              commercialMissionStatus: "phone_ready",
            },
          })
          .where(
            and(
              eq(opsTasks.tenantId, input.tenantId),
              eq(opsTasks.id, input.opsTaskId)
            )
          );
      }
      await syncCommercialPipelineForMissionTransitionWith(tx, {
        tenantId: input.tenantId,
        mission,
        toStatus: "phone_ready",
        actor: input.actor,
        correlationId: input.idempotencyKey,
        metadata: input.metadata,
      });
    },
  };
}

export async function completeDirectMissionPath(input: {
  tenantId: string;
  mission: CommercialMission;
  expectedVersion: number;
  requestId: string;
  actor: DirectMissionActor;
}): Promise<DirectCompletionResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return completeDirectMissionPathWith(
    {
      transaction(work) {
        return db.transaction(tx =>
          work(drizzleTransaction(tx, input.mission))
        );
      },
    },
    input,
    { dispatch: dispatchCommercialMission }
  );
}
