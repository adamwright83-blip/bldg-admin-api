/**
 * Campaign Run service — the standing instance of one real operation.
 *
 * docs/goldline/FICTION_PACKS.md sections 2, 3 and 5.
 *
 * What this service will not do, on purpose:
 * - store or increment a progress counter (progress is derived, every time);
 * - accept a placement without a measured, same-operator, still-valid
 *   territory-presence observation;
 * - let the denominator move after a run starts;
 * - let a replacement shrink the denominator instead of filling the slot;
 * - accept an assertion of GPS truth, campaign failure, or completion from a
 *   caller;
 * - let a run's fiction drift after it started (pack id AND version frozen).
 *
 * Survives `getDb()` returning null like every neighbouring service does.
 */
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  goldlineCampaignRuns,
  goldlineCampaignRunTargets,
  goldlineCampaignTargets,
  goldlineCampaignTargetEvents,
} from "../../drizzle/schema";
import {
  checkTerritoryPresence,
  deriveRunCadence,
  deriveRunProgress,
  type CampaignRun,
  type CampaignRunStatus,
  type CampaignTarget,
  type CampaignTargetEvent,
  type CampaignTargetEventKind,
  type PlacementPoint,
  type RunProgress,
  type RunTargetSlot,
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
import { getCampaign } from "../campaignLibrary/campaignLibraryService";
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
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    accuracyMeters: row.accuracyMeters ?? null,
    note: row.note ?? null,
  };
}

/**
 * Freeze a target set. Targets are operator-confirmed before this is called —
 * sourcing may eventually be assisted, confirmation may not be
 * (FICTION_PACKS.md section 5).
 *
 * Adding to a set after a run has started is harmless: a started run holds its
 * own snapshot and never re-reads the set for its denominator.
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

/** The frozen slot list for a started run. The denominator, and immutable. */
export async function listRunSlots(input: {
  tenantId: string;
  campaignRunId: string;
}): Promise<RunTargetSlot[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(goldlineCampaignRunTargets)
    .where(
      and(
        eq(goldlineCampaignRunTargets.tenantId, input.tenantId),
        eq(goldlineCampaignRunTargets.campaignRunId, input.campaignRunId)
      )
    );
  return rows.map(row => ({
    campaignRunId: row.campaignRunId,
    slotId: row.slotId,
    originalTargetId: row.originalTargetId,
  }));
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

  /* The denominator is frozen here and nowhere else. */
  const ordered = [...targets].sort((a, b) =>
    a.targetId.localeCompare(b.targetId)
  );
  for (const [index, target] of ordered.entries()) {
    await db.insert(goldlineCampaignRunTargets).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      campaignRunId: id,
      slotId: `slot-${String(index + 1).padStart(3, "0")}`,
      originalTargetId: target.targetId,
    });
  }

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

/** Operator's own runs, newest first. Empty when the database is unavailable. */
export async function listOperatorRuns(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<CampaignRun[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(goldlineCampaignRuns)
    .where(
      and(
        eq(goldlineCampaignRuns.tenantId, input.tenantId),
        eq(goldlineCampaignRuns.operatorUserId, input.operatorUserId)
      )
    )
    .orderBy(desc(goldlineCampaignRuns.startedAt));
  return rows.map(toRun);
}

/**
 * Every write of evidence passes through here first. A run that is not active,
 * or a caller who is not the run's operator, contributes nothing.
 */
async function assertWritableRun(input: {
  tenantId: string;
  campaignRunId: string;
  operatorUserId: string;
}): Promise<CampaignRun> {
  const run = await getCampaignRun(input);
  if (!run) throw new Error(`Unknown campaign run ${input.campaignRunId}`);
  if (run.status !== "active") {
    throw new Error(
      `Campaign run ${input.campaignRunId} is ${run.status}; evidence is only accepted while a run is active`
    );
  }
  if (run.operatorUserId !== input.operatorUserId) {
    throw new Error(
      "This run belongs to another operator. Evidence is recorded by the operator who is doing the work, and by nobody else."
    );
  }
  return run;
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
 * Territory presence, from a real observation.
 *
 * The caller supplies coordinates and the device's own accuracy reading; the
 * server decides whether that lands in the territory. A caller cannot declare
 * `device_location` — it is earned by a measurement that checks out, or the
 * event is refused. `occurredAt` is server time for the same reason: a
 * client-chosen timestamp would let anyone backdate their way into the
 * validity window.
 */
export async function recordTerritoryPresence(input: {
  tenantId: string;
  campaignRunId: string;
  operatorUserId: string;
  lat: number;
  lng: number;
  accuracyMeters?: number | null;
  note?: string | null;
}): Promise<{ eventId: string; distanceMeters: number } | null> {
  const db = await getDb();
  if (!db) return null;

  const run = await assertWritableRun(input);
  const targets = await listTargets({
    tenantId: input.tenantId,
    targetSetId: run.targetSetId,
  });

  const check = checkTerritoryPresence({
    observation: {
      lat: input.lat,
      lng: input.lng,
      accuracyMeters: input.accuracyMeters ?? null,
    },
    targets,
  });

  if (!check.inTerritory) {
    if (check.reason === "no_target_coordinates") {
      throw new Error(
        "No target in this set carries coordinates, so presence cannot be established. Territory presence is measured, never asserted."
      );
    }
    throw new Error(
      `That position is ${Math.round(check.distanceMeters ?? 0)}m from the nearest target in this run — outside the territory.`
    );
  }

  const eventId = randomUUID();
  await db.insert(goldlineCampaignTargetEvents).values({
    id: eventId,
    tenantId: input.tenantId,
    campaignRunId: input.campaignRunId,
    targetId: null,
    kind: "territory_presence",
    occurredAt: new Date(),
    operatorUserId: input.operatorUserId,
    provenance: "device_location",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    lat: String(input.lat),
    lng: String(input.lng),
    accuracyMeters: input.accuracyMeters ?? null,
    note: input.note ?? null,
  });

  return { eventId, distanceMeters: check.distanceMeters };
}

/**
 * A placement. Refuses without a presence event that is in this run, belongs
 * to this operator, happened before this placement, and is still inside the
 * validity window. `occurredAt` is server time: cadence and the validity
 * window both read it, so it is not the caller's to choose.
 */
export async function recordPlacement(input: {
  tenantId: string;
  campaignRunId: string;
  targetId: string;
  operatorUserId: string;
  supportingPresenceEventId: string;
  note?: string | null;
}): Promise<{ eventId: string } | null> {
  const db = await getDb();
  if (!db) return null;

  await assertWritableRun(input);

  const slots = await listRunSlots(input);
  const events = await listRunEvents(input);
  const progress = deriveRunProgress({
    campaignRunId: input.campaignRunId,
    slots,
    events,
  });
  if (!progress.slots.some(slot => slot.currentTargetId === input.targetId)) {
    throw new Error(
      `Target ${input.targetId} does not occupy a slot in this run. A placement can only be recorded against an address the run is actually carrying.`
    );
  }

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
  if (presence.operatorUserId !== input.operatorUserId) {
    throw new Error(
      "That presence observation belongs to another operator and cannot vouch for this placement."
    );
  }

  const eventId = randomUUID();
  await db.insert(goldlineCampaignTargetEvents).values({
    id: eventId,
    tenantId: input.tenantId,
    campaignRunId: input.campaignRunId,
    targetId: input.targetId,
    kind: "placement_reported",
    occurredAt: new Date(),
    operatorUserId: input.operatorUserId,
    provenance: "operator_reported",
    epistemicState: "confirmed",
    supportingPresenceEventId: input.supportingPresenceEventId,
    replacementTargetId: null,
    lat: null,
    lng: null,
    accuracyMeters: null,
    note: input.note ?? null,
  });

  await maybeCompleteRun(input);
  return { eventId };
}

/**
 * Retire an address in favour of a real replacement. The replacement takes
 * over the slot and the slot returns to incomplete — a run never completes by
 * shrinking. The replacement must already exist as sourced truth in the set.
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
    throw new Error("Replacing a target requires a truthful reason");
  }
  if (input.targetId === input.replacementTargetId) {
    throw new Error("A target cannot replace itself");
  }

  const run = await assertWritableRun(input);

  const slots = await listRunSlots(input);
  const events = await listRunEvents(input);
  const progress = deriveRunProgress({
    campaignRunId: input.campaignRunId,
    slots,
    events,
  });
  const slot = progress.slots.find(
    entry => entry.currentTargetId === input.targetId
  );
  if (!slot) {
    throw new Error(
      `Target ${input.targetId} does not occupy a slot in this run and cannot be replaced.`
    );
  }

  const targets = await listTargets({
    tenantId: input.tenantId,
    targetSetId: run.targetSetId,
  });
  const replacement = targets.find(
    target => target.targetId === input.replacementTargetId
  );
  if (!replacement) {
    throw new Error(
      `Replacement ${input.replacementTargetId} is not in this run's target set. A replacement is a real sourced address, never a new one invented here.`
    );
  }
  if (progress.slots.some(entry => entry.currentTargetId === replacement.targetId)) {
    throw new Error(
      `${replacement.targetId} already occupies a slot in this run — one address cannot fill two.`
    );
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
    lat: null,
    lng: null,
    accuracyMeters: null,
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
  const [slots, events] = await Promise.all([
    listRunSlots(input),
    listRunEvents(input),
  ]);
  return deriveRunProgress({
    campaignRunId: input.campaignRunId,
    slots,
    events,
  });
}

export type RunProjection = {
  run: CampaignRun;
  progress: RunProgress;
  fiction: {
    packId: string;
    packVersion: number;
    role: string;
    briefing: string;
    proofFraming: string;
    reachedBeats: Array<{ id: string; text: string }>;
    completion: { victory: string; tail: string; tier: TempoTier } | null;
    incomplete: { kind: "echo" | "failure"; text: string } | null;
  } | null;
};

/**
 * Whether the campaign declares a real failure condition, and whether it has
 * been met. Read from campaign truth on the server — never from the caller,
 * which must not be able to tell Goldline that a real-world failure happened.
 *
 * No campaign in the library declares one today, so this is honestly false.
 * When `GrowthCampaign` grows a `failureCondition`, read it here and evaluate
 * it here; nothing else needs to change.
 */
async function resolveFailureTruth(input: {
  tenantId: string;
  campaignId: string;
}): Promise<{ hasFailureCondition: boolean; failureConditionMet: boolean }> {
  const campaign = await getCampaign(input);
  const declared =
    campaign != null &&
    typeof (campaign as { failureCondition?: unknown }).failureCondition ===
      "string" &&
    ((campaign as { failureCondition?: string }).failureCondition ?? "").trim()
      .length > 0;
  return { hasFailureCondition: declared, failureConditionMet: false };
}

/**
 * The whole rendered state of a run. The fiction layer reads derived truth and
 * dramatizes it; it cannot write anything back, and it never sees a number the
 * campaign did not produce.
 */
export async function getRunProjection(input: {
  tenantId: string;
  campaignRunId: string;
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
  const failure = await resolveFailureTruth({
    tenantId: input.tenantId,
    campaignId: run.campaignId,
  });

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
              campaignHasFailureCondition: failure.hasFailureCondition,
              failureConditionMet: failure.failureConditionMet,
            },
            slots
          ),
    },
  };
}
