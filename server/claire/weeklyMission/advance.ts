/**
 * advanceWeeklySession — speech and a draft. No business writes.
 * Investigator, not a questionnaire. One question. Fail closed on a bad model act.
 */

import { lintPostGenerationStateVerbs, VerifiedFactInventoryBuilder } from "../assertionGuard";
import { G4_UNVERIFIED_STATE_VERB_FALLBACK } from "../verifiedFactInventoryFromContext";
import {
  WEEKLY_QUESTION_HARD_STOP,
  WEEKLY_QUESTION_PROPOSE_AT,
  capReadiness,
  cloneDraft,
  dayByName,
  defaultReadiness,
  isWeeklyCancel,
  isWeeklyLockBind,
  isWeeklyRejection,
  parseDayMove,
  readinessCompleteByOverride,
  resolveWeeklyExecutionType,
  splitReadinessClauses,
  weekdayName,
  type WeeklyAct,
  type WeeklyDayDraft,
  type WeeklyDraft,
} from "../../../shared/weeklyMissionReadiness";
import { deriveInternalHypothesis, type WeeklyDossier } from "./dossier";
import { acceptPlanningDecision, applyPlanningDecision } from "./planningDecision";
import { clearWeeklySession, normalizeWeeklySession, saveWeeklySession, type WeeklyPlanningSession } from "./session";

export type WeeklyAdvanceDeps = {
  /**
   * Existing Claire model. It chooses the next planning act.
   * Null or an invalid decision falls back to the deterministic questionnaire.
   */
  completeAct?: (input: {
    dossier: WeeklyDossier;
    session: WeeklyPlanningSession;
    operatorUtterance: string;
  }) => Promise<unknown>;
};

export type WeeklyAdvanceResult = {
  act: WeeklyAct;
  speech: string;
  draft: WeeklyDraft;
  session: WeeklyPlanningSession;
  writesBusinessTruth: false;
};

export async function advanceWeeklySession(
  input: { dossier: WeeklyDossier; session: WeeklyPlanningSession; operatorUtterance: string },
  deps: WeeklyAdvanceDeps = {}
): Promise<WeeklyAdvanceResult> {
  const session = normalizeWeeklySession(input.session);
  const utterance = input.operatorUtterance.trim();
  if (input.dossier.horizon.remainingDates.length === 0) {
    return finish(session, "CANCEL", "The weekday week is already over. I won't invent another one.", input.dossier);
  }
  if (utterance && isWeeklyCancel(utterance)) {
    await clearWeeklySession(session);
    return {
      act: "CANCEL",
      speech: "All right. I won't lock a week.",
      draft: session.draft,
      session,
      writesBusinessTruth: false,
    };
  }

  if (
    utterance &&
    isWeeklyLockBind(utterance) &&
    !parseDayMove(utterance) &&
    (session.phase === "proposal" || session.phase === "awaiting_confirmation")
  ) {
    session.phase = "awaiting_confirmation";
    session.lastQuestionKind = "confirm";
    return finish(
      session,
      "AWAIT_CONFIRMATION",
      "I have the week in front of us. Lock it only if you mean this exact week.",
      input.dossier
    );
  }

  if (utterance && isWeeklyRejection(utterance) && !parseDayMove(utterance) && session.phase !== "interview") {
    session.phase = "interview";
    const speech = nextQuestion(session, input.dossier) ?? "What should change?";
    return finish(session, "ASK", speech, input.dossier);
  }

  let revised = false;
  const move = utterance ? parseDayMove(utterance) : null;
  if (move) {
    const conflict = dayMoveConflicts(session.draft, move);
    applyDayMove(session.draft, move);
    session.phase = "interview";
    session.substantiveQuestions += 1;
    revised = true;
    if (conflict) {
      const to = dayByName(session.draft, move.to);
      return finish(
        session,
        "REVISE",
        to?.uncertainty ?? `${move.to} already has a mission. Which one survives?`,
        input.dossier
      );
    }
  }

  if (!session.internalHypothesis.summary.trim()) {
    session.internalHypothesis = deriveInternalHypothesis(input.dossier);
  }
  if (utterance) session.operatorEvidence.push(utterance.slice(0, 500));
  const decision = await modelDecision(input, deps, session);
  if (decision) {
    applyPlanningDecision(session, decision, input.dossier.growthCandidates);
    return finish(session, decision.act, decision.speech, input.dossier);
  }

  if (!move && utterance && session.lastQuestionKind === "readiness" && session.lastQuestionDate) {
    captureReadiness(session, utterance, input.dossier);
    session.substantiveQuestions += 1;
    revised = true;
  } else if (utterance && (session.lastQuestionKind === "primary" || session.lastQuestionKind === "blocking") && session.lastQuestionDate) {
    capturePrimary(session, utterance, input.dossier);
    session.substantiveQuestions += 1;
    revised = true;
  } else if (utterance && session.lastQuestionKind === null && session.substantiveQuestions === 0) {
    const target = session.draft.days.find(day => day.disposition === "primary" && !day.primary);
    if (target) session.lastQuestionDate = target.businessDate;
    session.lastQuestionKind = "primary";
    capturePrimary(session, utterance, input.dossier);
    session.substantiveQuestions += 1;
    revised = true;
  }

  const follow = nextQuestion(session, input.dossier);
  if (!follow) {
    session.phase = "awaiting_confirmation";
    session.lastQuestionKind = "confirm";
    const proposal = speakProposal(session.draft);
    return finish(session, "PROPOSE", revised && move ? moveSpeech(move, session.draft, proposal) : proposal, input.dossier);
  }
  if (session.phase === "awaiting_confirmation") session.phase = "interview";
  const speech = move ? moveSpeech(move, session.draft, follow) : follow;
  return finish(session, revised ? "REVISE" : "ASK", speech, input.dossier);
}

async function modelDecision(
  input: { dossier: WeeklyDossier; session: WeeklyPlanningSession; operatorUtterance: string },
  deps: WeeklyAdvanceDeps,
  session: WeeklyPlanningSession
): Promise<ReturnType<typeof acceptPlanningDecision>> {
  if (!deps.completeAct) return null;
  let raw: unknown = null;
  try {
    raw = await deps.completeAct({ dossier: input.dossier, session, operatorUtterance: input.operatorUtterance });
  } catch {
    return null;
  }
  return acceptPlanningDecision(raw, {
    dossier: input.dossier,
    session,
    utterance: input.operatorUtterance,
  });
}

function dayMoveConflicts(
  draft: WeeklyDraft,
  move: { from: WeeklyDayDraft["weekday"]; to: WeeklyDayDraft["weekday"] }
): boolean {
  const from = dayByName(draft, move.from);
  const to = dayByName(draft, move.to);
  return Boolean(from?.primary && to?.primary && from.primary.text !== to.primary.text);
}

function moveSpeech(
  move: { from: string; to: string },
  draft: WeeklyDraft,
  follow: string
): string {
  const from = dayByName(draft, move.from as WeeklyDayDraft["weekday"]);
  const to = dayByName(draft, move.to as WeeklyDayDraft["weekday"]);
  const moved = to?.primary?.text ? `${move.to} takes ${to.primary.text}.` : `${move.to} is the day.`;
  const opened = from?.primary ? "" : ` ${move.from} is open.`;
  if (follow.startsWith("I have enough")) return `${moved}${opened} ${follow}`;
  return `${moved}${opened} ${follow}`;
}

function applyDayMove(draft: WeeklyDraft, move: { from: WeeklyDayDraft["weekday"]; to: WeeklyDayDraft["weekday"] }): void {
  const from = dayByName(draft, move.from);
  const to = dayByName(draft, move.to);
  if (!from || !to || from === to) return;
  if (from.primary && to.primary && from.primary.text !== to.primary.text) {
    to.uncertainty = `${to.weekday} already has ${to.primary.text}. ${from.weekday} has ${from.primary.text}. Which one survives?`;
    return;
  }
  if (from.primary) {
    to.primary = from.primary;
    to.disposition = "primary";
    to.uncertainty = null;
    from.primary = null;
    from.uncertainty = null;
  }
}

function captureReadiness(session: WeeklyPlanningSession, utterance: string, dossier: WeeklyDossier): void {
  const day = session.draft.days.find(item => item.businessDate === session.lastQuestionDate);
  if (!day) return;
  if (/\bnothing\b|\bnone\b|\bthat's it\b/i.test(utterance) && splitReadinessClauses(utterance).length < 2) {
    return;
  }
  const override = readinessCompleteByOverride(utterance, dossier.horizon);
  const additions = splitReadinessClauses(utterance).map(text =>
    defaultReadiness({
      text,
      neededForDate: day.businessDate,
      completeByDate: override ?? undefined,
      executionType: day.primary?.executionType ?? null,
    })
  );
  day.readinessRequirements = capReadiness([...day.readinessRequirements, ...additions]);
}

function capturePrimary(
  session: WeeklyPlanningSession,
  utterance: string,
  dossier: WeeklyDossier
): void {
  const date =
    session.lastQuestionDate ??
    session.draft.days.find(day => !day.primary && day.disposition === "primary")?.businessDate;
  const day = session.draft.days.find(item => item.businessDate === date);
  if (!day) return;
  const isCurrentRemnant =
    dossier.horizon.todayIsRemnant &&
    day.businessDate === dossier.horizon.businessDate;
  if (isCurrentRemnant && remnantStandDown(utterance, day.weekday)) {
    day.disposition = "stand_down";
    day.primary = null;
    day.uncertainty = "Stood down for today.";
    return;
  }
  if (day.disposition === "stand_down") return;
  const text = utterance.replace(/\s+/g, " ").trim().slice(0, 255);
  day.primary = {
    text,
    source: "operator_stated",
    existingCommitmentId: null,
    executionType: resolveWeeklyExecutionType({
      text,
      candidates: dossier.growthCandidates,
    }),
  };
  day.uncertainty = null;
}

function remnantStandDown(
  utterance: string,
  weekday: WeeklyDayDraft["weekday"]
): boolean {
  const text = utterance
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
  const day = weekday.toLowerCase();
  const dayWord = "(?:today|" + day + ")";
  return new RegExp(
    "^(?:skip(?: " + dayWord + ")?|stand " + dayWord +
      " down|leave " + dayWord +
      " (?:open|alone)|nothing(?: " + dayWord +
      ")?|none(?: " + dayWord + ")?|not today)$"
  ).test(text);
}
function nextQuestion(session: WeeklyPlanningSession, dossier: WeeklyDossier): string | null {
  const empty = session.draft.days.find(day => day.disposition === "primary" && !day.primary);
  const readiness = session.draft.days.find(
    day => day.disposition === "primary" && day.primary && !session.readinessAskedDates.includes(day.businessDate)
  );
  const bounded = session.substantiveQuestions >= WEEKLY_QUESTION_PROPOSE_AT;
  const hard = session.substantiveQuestions >= WEEKLY_QUESTION_HARD_STOP;
  if (hard) {
    if (!empty) return null;
    session.askedBlocking = true;
    session.lastQuestionKind = "blocking";
    session.lastQuestionDate = empty.businessDate;
    empty.uncertainty = "Still no mission.";
    return `One thing still blocks the week. What owns ${empty.weekday}?`;
  }
  if (bounded && empty && !session.askedBlocking) {
    session.askedBlocking = true;
    session.lastQuestionKind = "blocking";
    session.lastQuestionDate = empty.businessDate;
    empty.uncertainty = "Still no mission.";
    return `One thing still blocks the week. What owns ${empty.weekday}?`;
  }
  if (bounded && !empty) return null;
  if (session.askedBlocking && !empty) return null;
  if (empty && (!bounded || !session.askedBlocking)) {
    if (session.substantiveQuestions >= WEEKLY_QUESTION_PROPOSE_AT && session.askedBlocking) return null;
    session.lastQuestionKind = "primary";
    session.lastQuestionDate = empty.businessDate;
    return askPrimary(empty, dossier);
  }
  if (readiness) {
    session.readinessAskedDates.push(readiness.businessDate);
    session.lastQuestionKind = "readiness";
    session.lastQuestionDate = readiness.businessDate;
    return `What has to be ready before ${readiness.weekday}?`;
  }
  return null;
}

function askPrimary(day: WeeklyDayDraft, dossier: WeeklyDossier): string {
  const known = dossier.facts.filter(
    fact => fact.businessDate === day.businessDate && fact.scheduleLabel
  );
  if (
    dossier.horizon.todayIsRemnant &&
    day.businessDate === dossier.horizon.businessDate
  ) {
    const later = dossier.horizon.remainingDates
      .filter(date => date !== day.businessDate)
      .map(date => weekdayName(date));
    const knownLine = known.length
      ? ` ${day.weekday} already has ${known
          .map(fact => `${fact.title} (${fact.scheduleLabel})`)
          .join(", ")}.`
      : "";
    const tail = later.length ? ` and build ${later.join(", ")}` : "";
    return `${day.weekday} is already underway, so I won\'t pretend it\'s a clean slate.${knownLine} Keep one thin primary for what\'s left today, or stand ${day.weekday} down${tail}?`;
  }
  if (known.length) {
    const listed = known.map(fact => `${fact.title} (${fact.scheduleLabel})`).join(", ");
    return `${day.weekday} already has ${listed}. What is the one mission that owns the rest of ${day.weekday}?`;
  }
  return `What is the one mission for ${day.weekday}?`;
}
export function speakProposal(draft: WeeklyDraft): string {
  const lines = draft.days.map(day => {
    if (day.disposition === "stand_down") return `${day.weekday}: stood down.`;
    const mission = day.primary?.text ?? "still open";
    const mark = day.primary?.source === "claire_recommended" ? " (my recommendation, not a fact)" : "";
    const fixed = day.fixedConstraints.map(item => `${item.title} ${item.scheduleLabel}`).join(", ");
    const ready = day.readinessRequirements.map(item => item.text).join(", ");
    const parts = [`${day.weekday}: ${mission}${mark}`];
    if (fixed) parts.push(`fixed ${fixed}`);
    if (ready) parts.push(`ready ${ready}`);
    if (!day.primary) parts.push("still uncertain");
    return parts.join(", ");
  });
  const uncertain = draft.days.filter(day => !day.primary && day.disposition === "primary").map(day => day.weekday);
  const leftover = uncertain.length ? ` Still open: ${uncertain.join(", ")}.` : "";
  return `I have enough. Here's the week I'd run. ${lines.join(". ")}.${leftover} Want me to lock this?`;
}

export function guardSpeech(speech: string, dossier: WeeklyDossier): string {
  const builder = new VerifiedFactInventoryBuilder();
  for (const fact of dossier.facts) {
    if (!fact.scheduleLabel) {
      builder.addGeneralFact({
        claimId: fact.id,
        statement: fact.title,
        entityRef: fact.id,
        status: "verified",
        provenance: fact.provenance.reader,
      });
      continue;
    }
    builder.addClaim({
      claimId: fact.id,
      statement: `${fact.title} is on the calendar at ${fact.scheduleLabel}`,
      entityRef: fact.id,
      claimedState: "scheduled",
      provenance: fact.provenance.reader,
      writtenTruthStatus: "scheduled",
    });
  }
  const lint = lintPostGenerationStateVerbs(speech, builder.build());
  return lint.pass ? speech : G4_UNVERIFIED_STATE_VERB_FALLBACK;
}

async function finish(
  session: WeeklyPlanningSession,
  act: WeeklyAct,
  speech: string,
  dossier: WeeklyDossier
): Promise<WeeklyAdvanceResult> {
  const safe = guardSpeech(speech, dossier);
  if (act !== "CANCEL") await saveWeeklySession(session);
  return {
    act,
    speech: safe,
    draft: cloneDraft(session.draft),
    session,
    writesBusinessTruth: false,
  };
}

export function weekdayLabel(date: string): string {
  return weekdayName(date);
}
