/**
 * Observed outcomes for Goldline campaign chapters whose presentation was
 * decided at the experiment decision point (BEHAVIORAL_SCIENCE_FOUNDATION.md §4).
 *
 * A chapter's behavioral subject is derived from its action grammar
 * (`grammar:<KIND>:<objectiveId>`), and no other producer ever writes to that
 * subject. Without these rows a chapter assignment could never be joined to
 * an outcome. Rows are written only for chapters that carry a recorded
 * assignment, so nothing is recorded for an operator who never consented.
 *
 * - COMPLETED: the campaign locked the chapter because its objective was
 *   authoritatively completed in business records. Game-only completions
 *   (Guardian finale) never produce one. `occurredAt` is when the server
 *   observed that, so start-to-complete latency is an upper bound.
 * - EXPIRED: a defined rule — the chapter's business day ended with the
 *   chapter unfinished. It says nothing about why. An objective that merely
 *   disappeared from the plan produces nothing.
 */
import type { CampaignChapter, CampaignInstance } from "../../shared/goldlineCampaign";
import { deriveCampaignChapterActionGrammar } from "../../shared/goldlineCampaignBindings";
import { behavioralSubjectFromGrammar } from "../../shared/behavioralSubject";
import { presentationDecisionPointId } from "../../shared/behavioralExperimentAssignment";
import type { BehavioralLedgerEvent } from "../../drizzle/schema";
import {
  listBehavioralLedgerEventsForDecisionPoint,
  recordBehavioralLedgerEvent,
  type BehavioralLedgerStore,
} from "../behavioralLedger/behavioralLedger";

type ChapterOutcome = "COMPLETED" | "EXPIRED";

async function recordChapterOutcome(input: {
  campaign: Pick<CampaignInstance, "id" | "tenantId" | "operatorId">;
  chapter: Pick<CampaignChapter, "stableChapterId" | "chapterKind" | "objectiveIds">;
  eventType: ChapterOutcome;
  observedAt: Date;
  store?: BehavioralLedgerStore;
}): Promise<BehavioralLedgerEvent | null> {
  const grammar = deriveCampaignChapterActionGrammar(input.chapter);
  if (!grammar) return null;
  const correlationId = behavioralSubjectFromGrammar(grammar);
  const decisionPointId = presentationDecisionPointId({ correlationId, occasionId: input.chapter.stableChapterId });
  const rows = await listBehavioralLedgerEventsForDecisionPoint(input.campaign.tenantId, decisionPointId, input.store);
  const assignment = rows.find(row =>
    row.eventType === "ASSIGNED" && row.operatorUserId === input.campaign.operatorId && row.correlationId === correlationId
  );
  if (!assignment || assignment.availability == null || !assignment.assignedOption) return null;
  const terminal = input.eventType === "COMPLETED" ? "completed" : "expired";
  return recordBehavioralLedgerEvent({
    tenantId: input.campaign.tenantId,
    operatorUserId: input.campaign.operatorId,
    correlationId,
    sourceSystem: "campaign_run",
    sourceEntityType: "campaign_chapter",
    sourceEntityId: `${input.campaign.id}:${input.chapter.stableChapterId}`.slice(0, 128),
    eventType: input.eventType,
    // Whole seconds, matching the column; see assignPresentation.ts.
    occurredAt: new Date(Math.floor(input.observedAt.getTime() / 1000) * 1000),
    // Business completion as the campaign observed it; never independently verified here.
    verificationClass: input.eventType === "COMPLETED" ? "CLAIMED" : null,
    provenance: input.eventType === "COMPLETED"
      ? "campaign_chapter_authoritative_objective_completed"
      : "campaign_chapter_business_day_ended_unfinished",
    evidenceSource: `assignment:${assignment.id}`,
    idempotencyKey: `campaign_chapter_${terminal}:${input.campaign.id}:${input.chapter.stableChapterId}`.slice(0, 191),
    // Carries the assignment's frozen fields so the join is direct.
    decisionPoint: {
      decisionPointId,
      availability: assignment.availability,
      eligibleOptions: (assignment.eligibleOptionsJson as string[] | null) ?? [],
      assignedOption: assignment.assignedOption,
      assignmentProbability: assignment.assignmentProbability == null ? null : Number(assignment.assignmentProbability),
      interventionPolicyVersion: assignment.interventionPolicyVersion ?? 1,
      interventionDefinitionVersion: assignment.interventionDefinitionVersion,
      proximalOutcomeWindowMinutes: assignment.proximalOutcomeWindowMinutes ?? 0,
    },
  }, input.store);
}

/** Chapters a committed revision newly locked as completed from authoritative business truth. */
export async function recordPresentedChapterCompletions(input: {
  before: Pick<CampaignInstance, "completedChapterIds">;
  after: CampaignInstance;
  observedAt?: Date;
  store?: BehavioralLedgerStore;
}): Promise<BehavioralLedgerEvent[]> {
  const already = new Set(input.before.completedChapterIds);
  const recorded: BehavioralLedgerEvent[] = [];
  for (const chapterId of input.after.completedChapterIds) {
    if (already.has(chapterId)) continue;
    const chapter = input.after.chapters.find(item => item.stableChapterId === chapterId);
    if (!chapter) continue;
    const row = await recordChapterOutcome({ campaign: input.after, chapter, eventType: "COMPLETED",
      observedAt: input.observedAt ?? new Date(), store: input.store });
    if (row) recorded.push(row);
  }
  return recorded;
}

/** Presented chapters of earlier business days that ended unfinished. */
export async function expireUnfinishedPresentedChapters(input: {
  priorCampaigns: readonly CampaignInstance[];
  today: string;
  observedAt?: Date;
  store?: BehavioralLedgerStore;
}): Promise<BehavioralLedgerEvent[]> {
  const recorded: BehavioralLedgerEvent[] = [];
  for (const campaign of input.priorCampaigns) {
    if (campaign.businessDate >= input.today) continue;
    const done = new Set(campaign.completedChapterIds);
    for (const chapter of campaign.chapters) {
      if (done.has(chapter.stableChapterId)) continue;
      const row = await recordChapterOutcome({ campaign, chapter, eventType: "EXPIRED",
        observedAt: input.observedAt ?? new Date(), store: input.store });
      if (row) recorded.push(row);
    }
  }
  return recorded;
}
