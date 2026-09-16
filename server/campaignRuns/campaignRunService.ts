/**
 * Campaign Run service — the standing instance of one real operation.
 *
 * docs/goldline/FICTION_PACKS.md sections 2, 3 and 5.
 *
 * What this service will not do, on purpose:
 * - store or increment a progress counter (progress is derived, every time);
 * - accept a placement without a resolvable territory-presence event;
 * - silently edit a frozen target (retirement goes through a replace event);
 * - let a run's fiction drift after it started (pack id AND version are frozen).
 *
 * Survives `getDb()` returning null like every neighbouring service does.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  goldlineCampaignRuns,
  goldlineCampaignTargets,
  goldlineCampaignTargetEvents,
} from "../../drizzle/schema";
import {
  deriveRunCadence,
  deriveRunProgress,
  type CampaignRun,
  type CampaignRunStatus,
  type CampaignTarget,
  type CampaignTargetEvent,
  type CampaignTargetEventKind,
  type PlacementPoint,
  type RunProgress,
  type TargetSourceClass,
} from "../../shared/campaignRun";
import {
  composeCompletion,
  resolveIncompleteCopy,
  resolveReachedBeats,
  type FictionSlots,
  type TempoTier,
} from "../../shared/fictionPack";
import type {
  EpistemicState,
  GoldlineProvenanceClass,
} from "../../shared/goldlineWorld";
import { getDb } from "../db";
import { getFictionPack } from "../fictionPacks/fictionPackRegistry";

function toRun(row: typeof goldlineCampaignRuns.$inferSelect): CampaignRun {
  return {
    campaignRunId: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    campaignId: row.campaignId,
    campaignVersion: row.campaignVersion,
    fictionPackId: row.fictionPackId ?? null,
    fictionPackVersion: row.fictionPackVersion ?? null,
    targetSetId: row.targetSetId,
    startedAt: row.startedAt.toISOString(),
    status: row.status as CampaignRunStatus,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toTarget(
  row: typeof goldlineCampaignTargets.$inferSelect
): CampaignTarget {
  return {
    targetId: row.targetId,
    targetSetId: row.targetSetId,
    label: row.label,
    address: row.address,
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    placementPoint: row.placementPoint as PlacementPoint,
    sourceNote: row.sourceNote,
    provenance: row.provenance as TargetSourceClass,
  };
}

function toEvent(
  row: typeof goldlineCampaignTargetEvents.$inferSelect
): CampaignTargetEvent {
  return {
    eventId: row.id,
    campaignRunId: row.campaignRunId,
    targetId: row.targetId ?? null,
    kind: row.kind as CampaignTargetEventKind,
    occurredAt: row.occurredAt.toISOString(),
    operatorUserId: row.operatorUserId,
    provenance: row.provenance as GoldlineProvenanceClass,
    epistemicState: row.epistemicState as EpistemicState,
    supportingPresenceEventId: row.supportingPresenceEventId ?? null,
    replacementTargetId: row.replacementTargetId ?? null,
    note: row.note ?? null,
  };
}

/**
 * Freeze a target set. Targets are operator-confirmed before this is called —
 * sourcing may eventually be assisted, confirmation may not be
 * (FICTION_PACKS.md section 5).
 */
export async function freezeTargetSet(input: {
  tenantId: string;
  targetSetId: string;
  targets: Array<Omit<CampaignTarget, "targetSetId">>;
}): Promise<{ frozen: number }> {
  const db = await getDb();
  if (!db) return { frozen: 0 };

  const seen = new Set<string>();
  for (const target of input.targets) {
    if (seen.has(target.targetId)) {
      throw new Error(`Duplicate targetId in set: ${target.targetId}`);
    }
    seen.add(target.targetId);
    if (!target.sourceNote.trim()) {
      throw new Error(
        `Target ${target.targetId} has no sourceNote — how an address was established is never blank`
      );
    }
  }

  for (const target of input.targets) {
    await db
      .insert(goldlineCampaignTargets)
      .values({
        id: randomUUID(),
        tenantId: input.tenantId,
        targetSetId: input.targetSetId,
        targetId: target.targetId,
        label: target.label,
        address: target.address,
        lat: target.lat == null ? null : String(target.lat),
        lng: target.lng == null ? null : String(target.lng),
        placementPoint: target.placementPoint,
        sourceNote: target.sourceNote,
        provenance: target.provenance,
      })
      .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
  }

  return { frozen: input.targets.length };
}

export async function listTargets(input: {
  tenantId: string;
  targetSetId: string;
}): Promise<CampaignTarget[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(goldlineCampaignTargets)
    .where(
      and(
        eq(goldlineCampaignTargets.tenantId, input.tenantId),
        eq(goldlineCampaignTargets.targetSetId, input.targetSetId)
      )
    );
  return rows.map(toTarget);
}

export async function startCampaignRun(input: {
  tenantId: string;
  operatorUserId: string;
  campaignId: string;
  campaignVersion?: number;
  targetSetId: string;
  fictionPackId?: string | null;
  fictionPackVersion?: number | null;
}): Promise<CampaignRun | null> {
  const db = await getDb();
  if (!db) return null;

  if (input.fictionPackId != null) {
    const version = input.fictionPackVersion ?? 1;
    if (!getFictionPack(input.fictionPackId, version)) {
      throw new Error(
        `Unknown fiction pack ${input.fictionPackId}@${version} — a run cannot freeze against a pack that is not shipped`
      );
    }
  }

  const targets = await listTargets({
    tenantId: input.tenantId,
    targetSetId: input.targetSetId,
  });
  if (targets.length === 0) {
    throw new Error(
      `Target set ${input.targetSetId} is empty — freeze real targets before starting a run`
    );
  }

  const id = randomUUID();
  await db.insert(goldlineCampaignRuns).values({
    id,
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    campaignId: input.campaignId,
    campaignVersion: input.campaignVersion ?? 1,
    fictionPackId: input.fictionPackId ?? null,
    fictionPackVersion:
      input.fictionPackId == null ? null : input.fictionPackVersion ?? 1,
    targetSetId: input.targetSetId,
    status: "active",
  });

  return getCampaignRun({ tenantId: input.tenantId, campaignRunId: id });
}

export async function getCampaignRun(input: {
  tenantId: string;
  campaignRunId: string;
}): Promise<CampaignRun | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(goldlineCampaignRuns)
    .where(
      and(
        eq(goldlineCampaignRuns.tenantId, input.tenantId),
        eq(goldlineCampaignRuns.id, input.campaignRunId)
      )
    )
    .limit(1);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function listRunEvents(input: {
  tenantId: string;
  campaignRunId: string;
}): Promise<CampaignTargetEvent[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(goldlineCampaignTargetEvents)
    .where(
      and(
        eq(goldlineCampaignTargetEvents.tenantId, input.tenantId),
        eq(goldlineCampaignTargetEvents.campaignRunId, input.campaignRunId)
      )
    );
  return rows.map(toEvent);
}

/**
 * Territory presence. `device_location` provenance, run-scoped, never tied to a
 * single target — GPS cannot tell adjacent addresses apart and this system does
 * not pretend it can (FICTION_PACKS.md section 3).
 */
export async function recordTerritoryPresence(input: {
  tenantId: string;
  campaignRunId: string;
  operatorUserId: string;
  occurredAt?: string;
  note?: string | null;
}): Promise<{ eventId: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const eventId = randomUUID();
  await db.insert(goldlineCampaignTargetEvents).values({
    id: eventId,
    tenantId: input.tenantId,
    campaignRunId: input.campaignRunId,
    targetId: null,
    kind: "territory_presence",
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    operatorUserId: input.operatorUserId,
    provenance: "device_location",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    note: input.note ?? null,
  });
  return { eventId };
}

/**
 * A placement. Refuses without a real presence event in the same run: presence
 * is never placement, and placement without presence is not a qualifying
 * placement. The refusal is deliberate and is the contract, not a validation
 * nicety.
 */
export async function recordPlacement(input: {
  tenantId: string;
  campaignRunId: string;
  targetId: string;
  operatorUserId: string;
  supportingPresenceEventId: string;
  occurredAt?: string;
  note?: string | null;
}): Promise<{ eventId: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const events = await listRunEvents({
    tenantId: input.tenantId,
    campaignRunId: input.campaignRunId,
  });
  const presence = events.find(
    event =>
      event.eventId === input.supportingPresenceEventId &&
      event.kind === "territory_presence"
  );
  if (!presence) {
    throw new Error(
      "A placement needs a territory-presence event from this run. Presence is never placement, and placement without presence never qualifies."
    );
  }

  const eventId = randomUUID();
  await db.insert(goldlineCampaignTargetEvents).values({
    id: eventId,
    tenantId: input.tenantId,
    campaignRunId: input.campaignRunId,
    targetId: input.targetId,
    kind: "placement_reported",
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    operatorUserId: input.operatorUserId,
    provenance: "operator_reported",
    epistemicState: "confirmed",
    supportingPresenceEventId: input.supportingPresenceEventId,
    replacementTargetId: null,
    note: input.note ?? null,
  });

  await maybeCompleteRun({
    tenantId: input.tenantId,
    campaignRunId: input.campaignRunId,
  });

  return { eventId };
}

/**
 * Retire a frozen target in favour of a real replacement. The only legal way a
 * frozen set changes.
 */
export async function replaceTarget(input: {
  tenantId: string;
  campaignRunId: string;
  targetId: string;
  replacementTargetId: string;
  operatorUserId: string;
  note: string;
}): Promise<{ eventId: string } | null> {
  const db = await getDb();
  if (!db) return null;
  if (!input.note.trim()) {
    throw new Error("Replacing a frozen target requires a truthful reason");
  }
  const eventId = randomUUID();
  await db.insert(goldlineCampaignTargetEvents).values({
    id: eventId,
    tenantId: input.tenantId,
    campaignRunId: input.campaignRunId,
    targetId: input.targetId,
    kind: "target_replaced",
    occurredAt: new Date(),
    operatorUserId: input.operatorUserId,
    provenance: "operator_observed",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: input.replacementTargetId,
    note: input.note,
  });
  return { eventId };
}

async function maybeCompleteRun(input: {
  tenantId: string;
  campaignRunId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const run = await getCampaignRun(input);
  if (!run || run.status !== "active") return;
  const progress = await getRunProgress(input);
  if (!progress?.complete) return;
  await db
    .update(goldlineCampaignRuns)
    .set({ status: "complete", completedAt: new Date() })
    .where(
      and(
        eq(goldlineCampaignRuns.tenantId, input.tenantId),
        eq(goldlineCampaignRuns.id, input.campaignRunId)
      )
    );
}

export async function getRunProgress(input: {
  tenantId: string;
  campaignRunId: string;
}): Promise<RunProgress | null> {
  const run = await getCampaignRun(input);
  if (!run) return null;
  const [targets, events] = await Promise.all([
    listTargets({ tenantId: input.tenantId, targetSetId: run.targetSetId }),
    listRunEvents(input),
  ]);
  return deriveRunProgress({
    campaignRunId: input.campaignRunId,
    targets,
    events,
  });
}

export type RunProjection = {
  run: CampaignRun;
  progress: RunProgress;
  /** Null when the run has no pack, or its frozen pack is no longer shipped. */
  fiction: {
    packId: string;
    packVersion: number;
    role: string;
    briefing: string;
    proofFraming: string;
    reachedBeats: Array<{ id: string; text: string }>;
    /** Present only on a real completion. */
    completion: { victory: string; tail: string; tier: TempoTier } | null;
    /** Present only while incomplete. Held ground, never debt. */
    incomplete: { kind: "echo" | "failure"; text: string } | null;
  } | null;
};

/**
 * The whole rendered state of a run. The fiction layer reads derived truth and
 * dramatizes it; it cannot write anything back, and it never sees a number the
 * campaign did not produce.
 */
export async function getRunProjection(input: {
  tenantId: string;
  campaignRunId: string;
  campaignHasFailureCondition?: boolean;
  failureConditionMet?: boolean;
}): Promise<RunProjection | null> {
  const run = await getCampaignRun(input);
  if (!run) return null;
  const progress = await getRunProgress(input);
  if (!progress) return null;

  if (run.fictionPackId == null || run.fictionPackVersion == null) {
    return { run, progress, fiction: null };
  }

  const pack = getFictionPack(run.fictionPackId, run.fictionPackVersion);
  if (!pack) return { run, progress, fiction: null };

  const slots: FictionSlots = {
    count: String(progress.qualified),
    total: String(progress.total),
    remaining: String(Math.max(0, progress.total - progress.qualified)),
    unit: pack.objectiveLabels.unit,
    unitPlural: pack.objectiveLabels.unitPlural,
    actionVerb: pack.objectiveLabels.action,
  };

  const cadence = deriveRunCadence(progress);

  return {
    run,
    progress,
    fiction: {
      packId: pack.id,
      packVersion: pack.version,
      role: pack.role,
      briefing: pack.briefing,
      proofFraming: pack.proofFraming,
      reachedBeats: resolveReachedBeats(pack, progress.fraction, slots),
      completion: progress.complete
        ? composeCompletion(
            pack,
            {
              sessionCount: cadence.sessionCount,
              largestGapDays: cadence.largestGapDays,
            },
            slots
          )
        : null,
      incomplete: progress.complete
        ? null
        : resolveIncompleteCopy(
            pack,
            {
              campaignHasFailureCondition:
                input.campaignHasFailureCondition ?? false,
              failureConditionMet: input.failureConditionMet ?? false,
            },
            slots
          ),
    },
  };
}
