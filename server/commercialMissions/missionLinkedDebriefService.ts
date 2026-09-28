import { and, desc, eq } from "drizzle-orm";
import {
  commercialMissionEvents,
  driverSalesJournals,
  fieldJournalExtractions,
} from "../../drizzle/schema";
import {
  groundFieldJournalExtraction,
  parseFieldJournalExtraction,
} from "../../shared/fieldJournal";
import {
  deriveMissionLinkedDebriefProposal,
  type MissionDebriefEmailDraft,
  type MissionLinkedDebriefState,
} from "../../shared/missionLinkedDebrief";
import { getDb } from "../db";
import { getCommercialMission } from "./commercialMissionStore";
import {
  getCommercialMissionFieldState,
  reconcileCommercialMissionVisitScore,
  recordCommercialMissionVisitOutcome,
} from "./commercialMissionFieldService";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function draftFromEvent(value: unknown): MissionDebriefEmailDraft | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const draft = row.draft;
  if (!draft || typeof draft !== "object") return null;
  const candidate = draft as Record<string, unknown>;
  if (
    typeof candidate.subject !== "string" ||
    typeof candidate.body !== "string" ||
    candidate.sendAuthorized !== false
  ) return null;
  return {
    to: typeof candidate.to === "string" ? candidate.to : null,
    subject: candidate.subject,
    body: candidate.body,
    sendAuthorized: false,
  };
}

async function readLatestDebrief(input: {
  tenantId: string;
  driverId: string;
  missionId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [journal] = await db
    .select()
    .from(driverSalesJournals)
    .where(and(
      eq(driverSalesJournals.tenantId, input.tenantId),
      eq(driverSalesJournals.driverId, input.driverId),
      eq(driverSalesJournals.debriefMissionId, input.missionId),
    ))
    .orderBy(desc(driverSalesJournals.createdAt))
    .limit(1);
  return journal ?? null;
}

async function readPersistedDraft(input: {
  tenantId: string;
  missionId: number;
  journalEntryId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [event] = await db
    .select({ metadataJson: commercialMissionEvents.metadataJson })
    .from(commercialMissionEvents)
    .where(and(
      eq(commercialMissionEvents.tenantId, input.tenantId),
      eq(commercialMissionEvents.missionId, input.missionId),
      eq(
        commercialMissionEvents.idempotencyKey,
        `mission-debrief-email-draft:${input.journalEntryId}`
      ),
    ))
    .limit(1);
  return draftFromEvent(event?.metadataJson);
}

export async function getMissionLinkedDebriefState(input: {
  tenantId: string;
  driverId: string;
  missionId: number;
}): Promise<MissionLinkedDebriefState> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const mission = await getCommercialMission({
    tenantId: input.tenantId,
    missionId: input.missionId,
  });
  if (!mission || mission.assignedTo !== input.driverId) {
    throw new Error("This mission is not assigned to this operator.");
  }

  const field = await getCommercialMissionFieldState({
    tenantId: input.tenantId,
    missionId: input.missionId,
  });
  if (!field?.field?.arrivedAt) {
    return { status: "not_started", missionId: input.missionId };
  }

  const journal = await readLatestDebrief(input);
  if (field.visitOutcome) {
    const emailDraft = journal
      ? await readPersistedDraft({
          tenantId: input.tenantId,
          missionId: input.missionId,
          journalEntryId: journal.id,
        })
      : null;
    return {
      status: "completed",
      missionId: input.missionId,
      journalEntryId: journal?.id ?? null,
      outcome: field.visitOutcome.outcome,
      emailDraft,
    };
  }

  if (!journal) return { status: "not_started", missionId: input.missionId };
  if (journal.processingStatus === "failed" || journal.processingStatus === "fallback") {
    return {
      status: "failed",
      missionId: input.missionId,
      journalEntryId: journal.id,
      message:
        journal.processingError ??
        (journal.processingStatus === "fallback"
          ? "Claire could not reliably structure this debrief. Your raw recording is still saved; record a correction instead of accepting a guessed outcome."
          : "Claire could not structure this debrief. Your raw recording is still saved."),
    };
  }
  if (
    journal.processingStatus === "captured" ||
    journal.processingStatus === "transcribing" ||
    journal.processingStatus === "extracting"
  ) {
    return {
      status: "processing",
      missionId: input.missionId,
      journalEntryId: journal.id,
    };
  }

  const [row] = await db
    .select({
      itemsJson: fieldJournalExtractions.itemsJson,
      status: fieldJournalExtractions.status,
    })
    .from(fieldJournalExtractions)
    .where(and(
      eq(fieldJournalExtractions.tenantId, input.tenantId),
      eq(fieldJournalExtractions.journalEntryId, journal.id),
    ))
    .orderBy(desc(fieldJournalExtractions.version))
    .limit(1);
  if (!row) {
    return {
      status: "processing",
      missionId: input.missionId,
      journalEntryId: journal.id,
    };
  }
  if (row.status !== "processed") {
    return {
      status: "failed",
      missionId: input.missionId,
      journalEntryId: journal.id,
      message:
        "Claire could not reliably structure this debrief. Your raw recording is still saved; record a correction instead of accepting a guessed outcome.",
    };
  }

  const transcript = journal.transcript.trim();
  const extraction = groundFieldJournalExtraction(
    parseFieldJournalExtraction(row.itemsJson),
    transcript
  );
  const proposal = deriveMissionLinkedDebriefProposal({
    extraction,
    transcript,
    buildingName: mission.account.name,
    knownEmail: mission.account.decisionMaker.email ?? null,
  });
  return {
    status: "ready",
    missionId: input.missionId,
    journalEntryId: journal.id,
    transcript,
    proposal,
  };
}

export async function finalizeMissionLinkedDebrief(input: {
  tenantId: string;
  driverId: string;
  missionId: number;
  journalEntryId: string;
  requestId: string;
  answer?: string;
  additionalAnswer?: string;
}): Promise<MissionLinkedDebriefState> {
  const state = await getMissionLinkedDebriefState(input);
  if (state.status === "completed") {
    // The outcome may have committed before a transient score write failed.
    // Reconcile the idempotent score event on retry instead of returning early
    // and permanently dropping the operator's visit credit.
    await reconcileCommercialMissionVisitScore({
      tenantId: input.tenantId,
      driverId: input.driverId,
      missionId: input.missionId,
      requestId: input.requestId,
    });
    return state;
  }
  if (state.status !== "ready" || state.journalEntryId !== input.journalEntryId) {
    throw new Error("Claire has not finished structuring this debrief yet.");
  }

  let followUpAt: Date | undefined;
  let emailDraft = state.proposal.emailDraft;
  const requiredAnswers = [
    [state.proposal.question, input.answer],
    [state.proposal.additionalQuestion, input.additionalAnswer],
  ] as const;
  for (const [question, rawAnswer] of requiredAnswers) {
    if (!question) continue;
    if (question.kind === "follow_up_at") {
      const when = rawAnswer ? new Date(rawAnswer) : null;
      if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        throw new Error("Tell Claire when they asked you to follow up.");
      }
      followUpAt = when;
      continue;
    }
    const email = rawAnswer?.trim() ?? "";
    if (!EMAIL.test(email)) throw new Error("Enter the email they actually gave you.");
    if (emailDraft) emailDraft = { ...emailDraft, to: email };
  }

  const mission = await getCommercialMission({
    tenantId: input.tenantId,
    missionId: input.missionId,
  });
  const field = await getCommercialMissionFieldState({
    tenantId: input.tenantId,
    missionId: input.missionId,
  });
  if (!mission || mission.assignedTo !== input.driverId || !field?.field?.arrivedAt) {
    throw new Error("The persisted arrival is no longer available for this debrief.");
  }

  // A requested email becomes a durable draft event only. There is deliberately
  // no transport call here: sending still requires a separate explicit approval.
  if (emailDraft) {
    if (!emailDraft.to) throw new Error("The requested email address is still missing.");
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const metadataJson = {
      sourceJournalEntryId: state.journalEntryId,
      draftStatus: "draft",
      draft: emailDraft,
      sendAuthorized: false,
    };
    await db
      .insert(commercialMissionEvents)
      .values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        eventName: "mission_debrief_email_draft",
        fromStatus: mission.status,
        toStatus: mission.status,
        actorType: "driver",
        actorId: input.driverId,
        idempotencyKey: `mission-debrief-email-draft:${state.journalEntryId}`,
        metadataJson,
      })
      .onDuplicateKeyUpdate({ set: { metadataJson } });
  }

  const persisted = await recordCommercialMissionVisitOutcome({
    tenantId: input.tenantId,
    missionId: input.missionId,
    actorId: input.driverId,
    expectedMissionVersion: mission.version,
    expectedFieldVersion: field.field.version,
    requestId: input.requestId,
    outcome: state.proposal.outcome,
    notes: state.transcript,
    ...(followUpAt ? { followUpAt } : {}),
    decisionMakerStatus: state.proposal.decisionMakerStatus,
    collateralDelivered: state.proposal.collateralDelivered,
    quoteRequested: state.proposal.quoteRequested,
    pilotRequested: state.proposal.pilotRequested,
    followUpRequested: state.proposal.followUpRequested,
    ...(state.proposal.reason ? { reason: state.proposal.reason } : {}),
  });
  if (!persisted.visitOutcome) throw new Error("Visit outcome was not persisted");

  return {
    status: "completed",
    missionId: input.missionId,
    journalEntryId: state.journalEntryId,
    outcome: persisted.visitOutcome.outcome,
    emailDraft: emailDraft ?? null,
  };
}
