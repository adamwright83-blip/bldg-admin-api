/**
 * Idempotent campaign publication. Two first reads cannot create two movies.
 * Revisions persist authored future only. Business truth stays in FieldToday.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  goldlineCampaignInstances,
  goldlineCampaignRevisions,
  goldlineFictionAssignments,
} from "../../drizzle/schema";
import {
  CAMPAIGN_RULES_VERSION,
  campaignGameEventContract,
  type CampaignChapter,
  type CampaignInstance,
  type CampaignPresentation,
  type CampaignRevisionDiff,
  type CampaignStatus,
  type TerritoryCampaignHint,
} from "../../shared/goldlineCampaign";
import { compileGoldlineCampaign } from "../../shared/goldlineCampaignCompiler";
import { goldlineObjectivesFromFieldToday } from "../../shared/goldlineCampaignObjectives";
import { campaignPacingFor } from "../../shared/goldlineCampaignPacing";
import { conversationSanctuaryRequired } from "../../shared/goldlineCampaignBindings";
import {
  explainCampaignRevision,
  markChapterCompleted,
  recompileCampaignFuture,
} from "../../shared/goldlineCampaignRevisions";
import { campaignEndingTreatment } from "../../shared/goldlineCampaignEndings";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import { getFieldToday } from "../field/fieldTodayService";
import { appendGoldlineWorldEvent } from "./worldEventStore";
import { listPresentedTerritories } from "./territoryService";
import {
  campaignTravelProviderState,
  estimateCampaignTravel,
} from "./campaignTravelAdapter";

function previousBusinessDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function toInstance(
  row: typeof goldlineCampaignInstances.$inferSelect
): CampaignInstance {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    businessDate: row.businessDate,
    rulesVersion: row.rulesVersion,
    campaignArchetypeId: row.campaignArchetypeId as CampaignInstance["campaignArchetypeId"],
    stableKey: row.stableKey,
    inputFingerprint: row.inputFingerprint,
    title: row.title,
    premise: row.premise,
    chapters: (row.chaptersJson as CampaignChapter[]) ?? [],
    currentChapterId: row.currentChapterId,
    completedChapterIds: (row.completedChapterIdsJson as string[]) ?? [],
    status: row.status as CampaignStatus,
    endingTreatment: row.endingTreatment,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function readCampaign(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
}): Promise<CampaignInstance | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select()
    .from(goldlineCampaignInstances)
    .where(
      and(
        eq(goldlineCampaignInstances.tenantId, input.tenantId),
        eq(goldlineCampaignInstances.businessDate, input.businessDate),
        eq(goldlineCampaignInstances.rulesVersion, CAMPAIGN_RULES_VERSION)
      )
    )
    .limit(1);
  return row ? toInstance(row) : null;
}

async function readPriorTitle(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select()
    .from(goldlineCampaignInstances)
    .where(
      and(
        eq(goldlineCampaignInstances.tenantId, input.tenantId),
        eq(goldlineCampaignInstances.businessDate, previousBusinessDate(input.businessDate))
      )
    )
    .orderBy(desc(goldlineCampaignInstances.createdAt))
    .limit(1);
  return row?.title ?? null;
}

async function recordCampaignEvent(input: {
  tenantId: string;
  campaignId: string;
  operatorId: string;
  eventType: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  const payload = {
    eventType: input.eventType,
    classification: "game_projection" as const,
    provenanceClass: "generated_game_fiction" as const,
  };
  if (!campaignGameEventContract(payload)) return;
  const occurredAt = new Date().toISOString();
  await appendGoldlineWorldEvent({
    tenantId: input.tenantId,
    physicalEntityId: null,
    eventType: input.eventType,
    classification: "game_projection",
    actorType: "system",
    actorId: input.operatorId,
    occurredAt,
    observedAt: occurredAt,
    sourceType: "goldline_campaign",
    sourceId: input.campaignId,
    sourceEvidenceReference: `goldline_campaign_instances:${input.campaignId}`,
    provenanceClass: "generated_game_fiction",
    verificationClass: "CLAIMED",
    confidence: "unknown",
    idempotencyKey: input.idempotencyKey,
    correlationId: input.campaignId,
    metadata: {
      campaignId: input.campaignId,
      classification: "game_projection",
      ...(input.metadata ?? {}),
    },
  });
}

async function insertCampaign(instance: CampaignInstance): Promise<CampaignInstance> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.insert(goldlineCampaignInstances).values({
      id: instance.id,
      tenantId: instance.tenantId,
      operatorId: instance.operatorId,
      businessDate: instance.businessDate,
      rulesVersion: instance.rulesVersion,
      stableKey: instance.stableKey,
      campaignArchetypeId: instance.campaignArchetypeId,
      title: instance.title,
      premise: instance.premise,
      inputFingerprint: instance.inputFingerprint,
      status: instance.status,
      currentChapterId: instance.currentChapterId,
      completedChapterIdsJson: instance.completedChapterIds,
      chaptersJson: instance.chapters,
      revision: instance.revision,
      endingTreatment: instance.endingTreatment,
      classification: "game_projection",
      startedAt: instance.startedAt ? new Date(instance.startedAt) : null,
      completedAt: instance.completedAt ? new Date(instance.completedAt) : null,
    });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const existing = await readCampaign(instance);
    if (!existing) throw error;
    return existing;
  }
  await recordCampaignEvent({
    tenantId: instance.tenantId,
    campaignId: instance.id,
    operatorId: instance.operatorId,
    eventType: "campaign_published",
    idempotencyKey: `campaign-published:${instance.tenantId}:${instance.stableKey}`,
    metadata: { title: instance.title, archetypeId: instance.campaignArchetypeId },
  });
  return instance;
}

async function persistRevision(input: {
  instance: CampaignInstance;
  diff: CampaignRevisionDiff;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(goldlineCampaignInstances)
    .set({
      inputFingerprint: input.instance.inputFingerprint,
      status: input.instance.status,
      currentChapterId: input.instance.currentChapterId,
      completedChapterIdsJson: input.instance.completedChapterIds,
      chaptersJson: input.instance.chapters,
      revision: input.instance.revision,
      endingTreatment: input.instance.endingTreatment,
      completedAt: input.instance.completedAt ? new Date(input.instance.completedAt) : null,
    })
    .where(eq(goldlineCampaignInstances.id, input.instance.id));
  try {
    await db.insert(goldlineCampaignRevisions).values({
      id: randomUUID(),
      tenantId: input.instance.tenantId,
      campaignId: input.instance.id,
      revision: input.diff.revision,
      inputFingerprint: input.diff.inputFingerprint,
      reasonCodesJson: input.diff.reasonCodes,
      addedFutureChapterIdsJson: input.diff.addedFutureChapterIds,
      removedFutureChapterIdsJson: input.diff.removedFutureChapterIds,
      reorderedFutureChapterIdsJson: input.diff.reorderedFutureChapterIds,
    });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
  }
  await recordCampaignEvent({
    tenantId: input.instance.tenantId,
    campaignId: input.instance.id,
    operatorId: input.instance.operatorId,
    eventType: "campaign_revised",
    idempotencyKey: `campaign-revised:${input.instance.id}:${input.diff.revision}`,
    metadata: { reasonCodes: input.diff.reasonCodes },
  });
}

async function latestRevision(campaignId: string): Promise<CampaignRevisionDiff | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select()
    .from(goldlineCampaignRevisions)
    .where(eq(goldlineCampaignRevisions.campaignId, campaignId))
    .orderBy(desc(goldlineCampaignRevisions.revision))
    .limit(1);
  if (!row) return null;
  return {
    campaignId: row.campaignId,
    revision: row.revision,
    inputFingerprint: row.inputFingerprint,
    reasonCodes: (row.reasonCodesJson as CampaignRevisionDiff["reasonCodes"]) ?? [],
    addedFutureChapterIds: (row.addedFutureChapterIdsJson as string[]) ?? [],
    removedFutureChapterIds: (row.removedFutureChapterIdsJson as string[]) ?? [],
    reorderedFutureChapterIds: (row.reorderedFutureChapterIdsJson as string[]) ?? [],
  };
}

function present(campaign: CampaignInstance, lastRevision: CampaignRevisionDiff | null): CampaignPresentation {
  const current = campaign.chapters.find(chapter => chapter.stableChapterId === campaign.currentChapterId);
  return {
    campaign,
    lastRevision,
    revisionExplanation: explainCampaignRevision(lastRevision),
    pacing: campaignPacingFor(campaign),
    conversationSanctuary: current
      ? conversationSanctuaryRequired(
          current.objectiveIds.map(id => ({
            id,
            physicalEntityId: null,
            kind: current.chapterKind === "recovery_branch" ? "recovery" : current.chapterKind === "follow_up_branch" ? "follow_up" : "commercial_visit",
            authority: "persisted_task",
            status: "ready",
            latitude: null,
            longitude: null,
            windowStart: null,
            windowEnd: null,
            priority: 1,
            explanation: "",
            sourceEvidenceReference: id,
          }))
        )
      : false,
    travelProviderState: campaignTravelProviderState(),
  };
}

export async function getOrMaterializeTodayCampaign(input: {
  tenantId: string;
  operatorId: string;
}): Promise<CampaignPresentation> {
  const today = await getFieldToday({
    tenantId: input.tenantId,
    userId: input.operatorId,
    includeAllAssignees: true,
  });
  let territories;
  try {
    territories = await listPresentedTerritories({ tenantId: input.tenantId });
  } catch {
    territories = await listPresentedTerritories({ tenantId: input.tenantId });
  }
  const hints: TerritoryCampaignHint[] = territories.map(item => ({
    territoryId: item.definition.id,
    memberPhysicalEntityIds: item.definition.members.map(member => member.physicalEntityId),
    confrontationReady: item.state.confrontationReady,
    cleared: item.state.cleared,
  }));
  const objectives = goldlineObjectivesFromFieldToday(today.timeline);
  const travel = await estimateCampaignTravel({
    points: objectives.map(item => ({
      objectiveId: item.id,
      latitude: item.latitude,
      longitude: item.longitude,
    })),
  });
  const priorCampaignTitle = await readPriorTitle({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: today.businessDate,
  });
  const draft = compileGoldlineCampaign({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: today.businessDate,
    objectives,
    territories: hints,
    obligationDue: today.timeline.some(item => item.kind === "field_commitment"),
    priorCampaignTitle,
    travelWindowFingerprint: travel.fingerprint,
  });
  const existing = await readCampaign({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: today.businessDate,
  });
  if (!existing) {
    const created = await insertCampaign({
      ...draft,
      id: randomUUID(),
      revision: 1,
      createdAt: new Date().toISOString(),
      startedAt: draft.status === "quiet" ? null : new Date().toISOString(),
      completedAt: null,
    });
    return present(created, null);
  }
  const { instance, diff } = recompileCampaignFuture({ instance: existing, next: draft });
  if (!diff) return present(existing, await latestRevision(existing.id));
  const unresolvedFollowUp = objectives.some(
    item => (item.kind === "follow_up" || item.kind === "recovery") && item.status === "ready"
  );
  const ending = campaignEndingTreatment({
    draft: instance,
    territories: hints,
    unresolvedFollowUp,
  });
  const next: CampaignInstance = {
    ...instance,
    endingTreatment: instance.status === "completed" ? ending.copy : instance.endingTreatment,
  };
  await persistRevision({ instance: next, diff });
  return present(next, diff);
}

export async function chooseCampaignBranch(input: {
  tenantId: string;
  operatorId: string;
  chapterId: string;
}): Promise<CampaignPresentation> {
  const presented = await getOrMaterializeTodayCampaign(input);
  const chapter = presented.campaign.chapters.find(item => item.stableChapterId === input.chapterId);
  if (!chapter || chapter.required) return presented;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(goldlineCampaignInstances)
    .set({ currentChapterId: chapter.stableChapterId, status: "active" })
    .where(eq(goldlineCampaignInstances.id, presented.campaign.id));
  await recordCampaignEvent({
    tenantId: input.tenantId,
    campaignId: presented.campaign.id,
    operatorId: input.operatorId,
    eventType: "campaign_branch_chosen",
    idempotencyKey: `campaign-branch:${presented.campaign.id}:${chapter.stableChapterId}`,
    metadata: { chapterId: chapter.stableChapterId },
  });
  return present({ ...presented.campaign, currentChapterId: chapter.stableChapterId, status: "active" }, presented.lastRevision);
}

export async function recordCampaignChapterGameCompleted(input: {
  tenantId: string;
  operatorId: string;
  chapterId: string;
}): Promise<CampaignPresentation> {
  const presented = await getOrMaterializeTodayCampaign(input);
  const chapter = presented.campaign.chapters.find(item => item.stableChapterId === input.chapterId);
  if (!chapter) return presented;
  if (chapter.selectedGameplayBinding !== "guardian_finale" && chapter.chapterKind !== "guardian_finale") {
    return presented;
  }
  const next = markChapterCompleted(presented.campaign, chapter.stableChapterId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(goldlineCampaignInstances)
    .set({
      currentChapterId: next.currentChapterId,
      completedChapterIdsJson: next.completedChapterIds,
      status: next.status,
      completedAt: next.completedAt ? new Date(next.completedAt) : null,
    })
    .where(eq(goldlineCampaignInstances.id, presented.campaign.id));
  await recordCampaignEvent({
    tenantId: input.tenantId,
    campaignId: presented.campaign.id,
    operatorId: input.operatorId,
    eventType: "campaign_chapter_game_completed",
    idempotencyKey: `campaign-chapter-game:${presented.campaign.id}:${chapter.stableChapterId}`,
    metadata: { chapterId: chapter.stableChapterId, gameOnly: true },
  });
  return present(next, presented.lastRevision);
}

export async function listOperatorCampaigns(input: {
  tenantId: string;
  operatorId: string;
}): Promise<CampaignInstance[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(goldlineCampaignInstances)
    .where(eq(goldlineCampaignInstances.tenantId, input.tenantId))
    .orderBy(desc(goldlineCampaignInstances.businessDate))
    .limit(14);
  return rows.map(toInstance);
}

export async function upsertFictionAssignmentIfAbsent(input: {
  tenantId: string;
  operatorId: string;
  stableMissionKey: string;
  templateId: string;
  rulesVersion: number;
}): Promise<{ templateId: string; created: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db
    .select()
    .from(goldlineFictionAssignments)
    .where(
      and(
        eq(goldlineFictionAssignments.tenantId, input.tenantId),
        eq(goldlineFictionAssignments.operatorId, input.operatorId),
        eq(goldlineFictionAssignments.stableMissionKey, input.stableMissionKey)
      )
    )
    .limit(1);
  if (existing) return { templateId: existing.templateId, created: false };
  try {
    await db.insert(goldlineFictionAssignments).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      stableMissionKey: input.stableMissionKey,
      templateId: input.templateId,
      rulesVersion: input.rulesVersion,
    });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const [dup] = await db
      .select()
      .from(goldlineFictionAssignments)
      .where(
        and(
          eq(goldlineFictionAssignments.tenantId, input.tenantId),
          eq(goldlineFictionAssignments.operatorId, input.operatorId),
          eq(goldlineFictionAssignments.stableMissionKey, input.stableMissionKey)
        )
      )
      .limit(1);
    if (!dup) throw error;
    return { templateId: dup.templateId, created: false };
  }
  return { templateId: input.templateId, created: true };
}
