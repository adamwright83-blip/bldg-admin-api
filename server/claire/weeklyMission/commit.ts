/**
 * commitWeeklyPlan — the only weekly path that writes business truth.
 * Explicit lock only. Partial failure stays IN_PROGRESS and names the day.
 * Readiness stays on the intent unless the operator named a clock.
 */

import { randomUUID } from "node:crypto";
import type { MutationReceipt } from "../assertionGuard";
import { lintReceiptBackedCommitSpeech } from "../assertionGuard";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import { emptyCommandMetadata } from "../../../shared/claireWorkdayCommand";
import {
  type WeeklyIntentDay,
  type WeeklyIntentRecord,
} from "../../../shared/weeklyMissionReadiness";
import { acceptProposal, designateDayDirectorPrimary } from "../../dayDirector/dayDirectorService";
import { latestWeeklyIntent, saveWeeklyIntent } from "./intentStore";
import {
  clearWeeklySession,
  newWeeklySession,
  saveWeeklySession,
  type WeeklyPlanningSession,
} from "./session";
import { deriveInternalHypothesis, draftFromDossier, type WeeklyDossier } from "./dossier";

export type WeeklyCommitPorts = {
  designatePrimary: typeof designateDayDirectorPrimary;
  acceptProposal: typeof acceptProposal;
  saveIntent: typeof saveWeeklyIntent;
  latestIntent: typeof latestWeeklyIntent;
};

const defaultPorts: WeeklyCommitPorts = {
  designatePrimary: designateDayDirectorPrimary,
  acceptProposal,
  saveIntent: saveWeeklyIntent,
  latestIntent: latestWeeklyIntent,
};

export type WeeklyCommitResult = {
  locked: boolean;
  speech: string;
  receipts: MutationReceipt[];
  commitmentIds: string[];
  intent: WeeklyIntentRecord | null;
};

export async function commitWeeklyPlan(
  input: {
    session: WeeklyPlanningSession;
    now?: Date;
  },
  ports: WeeklyCommitPorts = defaultPorts
): Promise<WeeklyCommitResult> {
  const now = input.now ?? new Date();
  const session = input.session;
  if (session.phase !== "proposal" && session.phase !== "awaiting_confirmation") {
    return {
      locked: false,
      speech: "The week is not locked. I have not asked you to lock it.",
      receipts: [],
      commitmentIds: [],
      intent: null,
    };
  }

  const receipts: MutationReceipt[] = [];
  const commitmentIds: string[] = [];
  const days: WeeklyIntentDay[] = [];

  for (const day of session.draft.days) {
    if (day.disposition === "stand_down") {
      days.push(intentDay(day, null));
      continue;
    }
    if (!day.primary?.text.trim()) {
      await saveWeeklySession(session);
      return failure(day.weekday, receipts, commitmentIds);
    }
    try {
      const existing = session.committedRefs[day.businessDate];
      const commitmentId = existing
        ? (
            await ports.designatePrimary({
              tenantId: session.tenantId,
              actorId: session.dayDirectorActorId,
              businessDate: day.businessDate,
              commitmentId: existing.commitmentId,
              nowIso: now.toISOString(),
            })
          ).commitmentId
        : day.primary.existingCommitmentId
          ? (
              await ports.designatePrimary({
                tenantId: session.tenantId,
                actorId: session.dayDirectorActorId,
                businessDate: day.businessDate,
                commitmentId: day.primary.existingCommitmentId,
                nowIso: now.toISOString(),
              })
            ).commitmentId
          : await createPrimary(session, day.businessDate, day.primary.text, now, ports);
      session.committedRefs[day.businessDate] = {
        commitmentId,
        idempotencyKey: primaryKey(session.weekStart, day.businessDate),
      };
      commitmentIds.push(commitmentId);
      receipts.push({
        claimedState: day.primary.existingCommitmentId || existing ? "updated" : "created",
        entityId: commitmentId,
        statement: `${day.weekday}: ${existing || day.primary.existingCommitmentId ? "designated" : "created"} ${day.primary.text}`,
      });
      for (const item of day.readinessRequirements) {
        const clock = explicitClock(item.text);
        if (!clock) continue;
        const readinessId = await createScheduledReadiness(session, item.completeByDate, item.text, clock, ports);
        receipts.push({
          claimedState: "created",
          entityId: readinessId,
          statement: `${day.weekday} readiness created ${item.text}`,
        });
      }
      days.push(intentDay(day, commitmentId));
      await saveWeeklySession(session);
    } catch {
      await saveWeeklySession(session);
      return failure(day.weekday, receipts, commitmentIds);
    }
  }

  const prior = await ports.latestIntent({
    tenantId: session.tenantId,
    operatorId: session.operatorId,
    weekStart: session.weekStart,
  }).catch(() => null);
  const intent: WeeklyIntentRecord = {
    id: randomUUID(),
    tenantId: session.tenantId,
    operatorId: session.operatorId,
    weekStart: session.weekStart,
    revision: (prior?.revision ?? 0) + 1,
    source: "operator_confirmed_proposal",
    lockedAt: now.toISOString(),
    days,
  };
  try {
    await ports.saveIntent(intent);
  } catch {
    await saveWeeklySession(session);
    return {
      locked: false,
      speech: `${failureSpeech("the save")} The week is not locked.`,
      receipts,
      commitmentIds,
      intent: null,
    };
  }
  await clearWeeklySession(session);
  const speech = commitSpeech(receipts);
  return { locked: true, speech, receipts, commitmentIds, intent };
}

export async function reopenWeeklySession(input: {
  tenantId: string;
  operatorId: string;
  dayDirectorActorId: string;
  dossier: WeeklyDossier;
  prior: WeeklyIntentRecord | null;
}): Promise<WeeklyPlanningSession> {
  const draft = draftFromDossier(input.dossier);
  for (const day of draft.days) {
    const previous = input.prior?.days.find(item => item.businessDate === day.businessDate);
    if (!previous) continue;
    day.disposition = previous.disposition;
    day.readinessRequirements = previous.readinessRequirements.slice(0, 4);
    if (previous.primary) {
      day.primary = {
        text: previous.primary.text,
        source: previous.primary.commitmentId ? "existing_work" : previous.primary.source,
        existingCommitmentId: previous.primary.commitmentId,
      };
    }
  }
  const session = newWeeklySession({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    dayDirectorActorId: input.dayDirectorActorId,
    weekStart: input.dossier.horizon.weekStart,
    draft,
    adjust: true,
  });
  session.internalHypothesis = deriveInternalHypothesis(input.dossier);
  await saveWeeklySession(session);
  return session;
}

function intentDay(
  day: WeeklyPlanningSession["draft"]["days"][number],
  commitmentId: string | null
): WeeklyIntentDay {
  return {
    businessDate: day.businessDate,
    weekday: day.weekday,
    disposition: day.disposition,
    primary: day.primary
      ? {
          text: day.primary.text,
          source: day.primary.source,
          commitmentId,
        }
      : null,
    fixedConstraints: day.fixedConstraints,
    readinessRequirements: day.readinessRequirements,
  };
}

function primaryKey(weekStart: string, businessDate: string): string {
  return `weekly-primary:${weekStart}:${businessDate}`;
}

async function createPrimary(
  session: WeeklyPlanningSession,
  businessDate: string,
  title: string,
  now: Date,
  ports: WeeklyCommitPorts
): Promise<string> {
  const proposal: DayDirectorProposal = {
    promptKey: primaryKey(session.weekStart, businessDate),
    title: title.slice(0, 255),
    kind: "growth",
    quantity: null,
    sourceText: title,
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
    targetBusinessDate: businessDate,
    command: {
      ...emptyCommandMetadata(),
      role: "primary",
      designatedBy: "operator_confirmed_proposal",
      designatedAt: now.toISOString(),
    },
  };
  const stored = await ports.acceptProposal({
    tenantId: session.tenantId,
    actorId: session.dayDirectorActorId,
    businessDate,
    proposal,
  });
  if (!stored?.id) throw new Error(`Primary was not stored for ${businessDate}`);
  const designated = await ports.designatePrimary({
    tenantId: session.tenantId,
    actorId: session.dayDirectorActorId,
    businessDate,
    commitmentId: stored.id,
    nowIso: now.toISOString(),
  });
  return designated.commitmentId;
}

async function createScheduledReadiness(
  session: WeeklyPlanningSession,
  businessDate: string,
  text: string,
  clock: string,
  ports: WeeklyCommitPorts
): Promise<string> {
  const proposal: DayDirectorProposal = {
    promptKey: `weekly-readiness:${session.weekStart}:${businessDate}:${clock}`.slice(0, 191),
    title: text.slice(0, 255),
    kind: "prep",
    quantity: null,
    sourceText: text,
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
    targetBusinessDate: businessDate,
    command: emptyCommandMetadata(),
  };
  const stored = await ports.acceptProposal({
    tenantId: session.tenantId,
    actorId: session.dayDirectorActorId,
    businessDate,
    proposal,
  });
  if (!stored?.id) throw new Error(`Scheduled readiness was not stored for ${businessDate}`);
  return stored.id;
}

function explicitClock(text: string): string | null {
  const spoken = /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i.exec(text);
  if (spoken) return spoken[1]!;
  const hhmm = /\b([01]\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (hhmm) return hhmm[0];
  const atHour = /\bat\s+(\d{1,2})(?::(\d{2}))?\b/i.exec(text);
  if (atHour) return atHour[2] ? `${atHour[1]}:${atHour[2]}` : atHour[1]!;
  return null;
}

function failure(weekday: string, receipts: MutationReceipt[], commitmentIds: string[]): WeeklyCommitResult {
  return {
    locked: false,
    speech: `${weekday} did not lock. The week is not locked.`,
    receipts,
    commitmentIds,
    intent: null,
  };
}

function failureSpeech(what: string): string {
  return `${what} did not lock.`;
}

function commitSpeech(receipts: MutationReceipt[]): string {
  const lines = receipts.map(receipt => receipt.statement);
  const speech = ["Locked.", ...lines].join(" ");
  const lint = lintReceiptBackedCommitSpeech(speech, receipts);
  if (lint.pass) return speech;
  return ["Locked.", ...lines].join(" ");
}
