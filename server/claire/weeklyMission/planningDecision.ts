/**
 * Structured planning decision from the existing Claire model.
 * Deterministic code accepts or rejects it. A rejected decision is not applied.
 * The hypothesis stays private: it is not the proposed week and not a lock.
 */

import {
  capReadiness,
  defaultReadiness,
  isReadinessKind,
  resolveWeeklyExecutionType,
  WEEKLY_QUESTION_HARD_STOP,
  type WeeklyAct,
  type WeeklyDraft,
  type WeeklyExecutionCandidateContract,
  type WeeklyUncertainty,
} from "../../../shared/weeklyMissionReadiness";
import { lintPostGenerationStateVerbs, VerifiedFactInventoryBuilder } from "../assertionGuard";
import { G4_UNVERIFIED_STATE_VERB_FALLBACK } from "../verifiedFactInventoryFromContext";
import type { WeeklyDossier } from "./dossier";
import type { WeeklyPlanningSession } from "./session";

const ACTS: WeeklyAct[] = ["ASK", "PROPOSE", "REVISE", "AWAIT_CONFIRMATION", "CANCEL"];

export type WeeklyDraftDayPatch = {
  businessDate: string;
  primaryText?: string;
  readiness?: Array<{ text: string; completeByDate?: string | null }>;
};

export type WeeklyPlanningDecision = {
  act: WeeklyAct;
  speech: string;
  hypothesisSummary: string;
  uncertainties: Array<{
    text: string;
    businessDate: string | null;
    status: WeeklyUncertainty["status"];
  }>;
  focusUncertainty: string | null;
  draftDays: WeeklyDraftDayPatch[] | null;
};

export function planningCorpus(input: {
  dossier: WeeklyDossier;
  session: WeeklyPlanningSession;
  utterance: string;
}): string {
  const parts = [
    input.utterance,
    ...input.session.operatorEvidence,
    ...input.dossier.facts.flatMap(fact => [fact.title, fact.scheduleLabel ?? "", fact.weekday ?? ""]),
    ...input.session.draft.days.flatMap(day => [
      day.primary?.text ?? "",
      ...day.readinessRequirements.map(item => item.text),
      ...day.fixedConstraints.map(item => `${item.title} ${item.scheduleLabel}`),
    ]),
  ];
  return parts.join(" ").toLowerCase();
}

/**
 * Hypothesis speech may name a canonical growth option.
 * The commitment corpus used for primaries does not include those titles.
 */
export function hypothesisCorpus(input: {
  dossier: WeeklyDossier;
  session: WeeklyPlanningSession;
  utterance: string;
}): string {
  const options = (input.dossier.growthCandidates ?? []).flatMap(candidate => [
    candidate.id,
    candidate.title,
    candidate.objective,
    candidate.motion,
    ...candidate.sourceRefs.map(ref => ref.sourceId),
  ]);
  return `${planningCorpus(input)} ${options.join(" ")}`.toLowerCase();
}

export function acceptPlanningDecision(
  raw: unknown,
  input: { dossier: WeeklyDossier; session: WeeklyPlanningSession; utterance: string }
): WeeklyPlanningDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const act = record.act;
  const speech = typeof record.speech === "string" ? record.speech.trim() : "";
  if (!ACTS.includes(act as WeeklyAct) || !speech) return null;
  if (act === "CANCEL") return null;
  if (guardSpeech(speech, input.dossier) === G4_UNVERIFIED_STATE_VERB_FALLBACK) return null;
  if (/\b(i diagnose|you have adhd|you always avoid)\b/i.test(speech)) return null;
  const commitments = planningCorpus(input);
  const hypothesisText = hypothesisCorpus(input);
  if (!namesAreGrounded(speech, hypothesisText)) return null;
  if (!clocksAreGrounded(speech, commitments)) return null;
  if (!addressesAreGrounded(speech, commitments)) return null;
  if (asksToRestateKnown(speech, input.dossier)) return null;

  const hypothesisSummary = typeof record.hypothesisSummary === "string" ? record.hypothesisSummary.trim().slice(0, 500) : "";
  if (hypothesisSummary && !namesAreGrounded(hypothesisSummary, hypothesisText)) return null;
  if (hypothesisSummary && !clocksAreGrounded(hypothesisSummary, commitments)) return null;
  const uncertainties = parseUncertainties(record.uncertainties, input.dossier, hypothesisText);
  if (!uncertainties) return null;
  const focusUncertainty = typeof record.focusUncertainty === "string" ? record.focusUncertainty.trim().slice(0, 240) : null;
  if (focusUncertainty && !namesAreGrounded(focusUncertainty, hypothesisText)) return null;
  const draftDays = parseDraftDays(record.draftDays, input.dossier, commitments);
  if (draftDays === undefined) return null;

  let resolvedAct = act as WeeklyAct;
  if (resolvedAct === "AWAIT_CONFIRMATION" && input.session.phase === "interview") {
    resolvedAct = "PROPOSE";
  }
  const preview = previewDraft(input.session.draft, draftDays, input.dossier.growthCandidates);
  if (
    (resolvedAct === "PROPOSE" || resolvedAct === "AWAIT_CONFIRMATION") &&
    !weekIsDefensible(preview, input.dossier)
  ) {
    return null;
  }
  if (
    resolvedAct === "ASK" &&
    input.session.substantiveQuestions >= WEEKLY_QUESTION_HARD_STOP &&
    weekIsDefensible(preview, input.dossier)
  ) {
    resolvedAct = "PROPOSE";
  }
  return {
    act: resolvedAct,
    speech,
    hypothesisSummary,
    uncertainties,
    focusUncertainty,
    draftDays,
  };
}

export function applyPlanningDecision(
  session: WeeklyPlanningSession,
  decision: WeeklyPlanningDecision,
  candidates?: readonly WeeklyExecutionCandidateContract[]
): void {
  session.internalHypothesis = {
    summary: decision.hypothesisSummary,
    uncertainties: decision.uncertainties.map((item, index) => ({
      id: `u${index + 1}`,
      text: item.text,
      businessDate: item.businessDate,
      status: item.status,
    })),
  };
  if (decision.draftDays) {
    for (const patch of decision.draftDays) {
      const day = session.draft.days.find(item => item.businessDate === patch.businessDate);
      if (!day || day.disposition === "stand_down") continue;
      if (patch.primaryText) {
        const said = session.operatorEvidence.some(line => line.toLowerCase().includes(patch.primaryText!.toLowerCase()));
        const executionType = resolveWeeklyExecutionType({ text: patch.primaryText, candidates });
        day.primary = {
          text: patch.primaryText.slice(0, 255),
          source: said ? "operator_stated" : "existing_work",
          existingCommitmentId: day.primary?.existingCommitmentId ?? null,
          executionType,
        };
        day.uncertainty = null;
      }
      if (patch.readiness) {
        const executionType = day.primary?.executionType ?? null;
        day.readinessRequirements = capReadiness(
          patch.readiness.map(item =>
            defaultReadiness({
              text: item.text,
              neededForDate: day.businessDate,
              completeByDate: item.completeByDate ?? undefined,
              executionType,
            })
          )
        );
      }
    }
  }
  if (decision.act === "PROPOSE" || decision.act === "AWAIT_CONFIRMATION") {
    session.phase = "awaiting_confirmation";
    session.lastQuestionKind = "confirm";
  } else {
    if (session.phase === "awaiting_confirmation") session.phase = "interview";
    session.lastQuestionKind = decision.focusUncertainty ? "blocking" : "primary";
    const focused = decision.uncertainties.find(item => item.text === decision.focusUncertainty);
    session.lastQuestionDate = focused?.businessDate ?? session.lastQuestionDate;
  }
  if (decision.act === "ASK" || decision.act === "REVISE") {
    session.substantiveQuestions += 1;
  }
}

function parseUncertainties(
  value: unknown,
  dossier: WeeklyDossier,
  corpus: string
): WeeklyPlanningDecision["uncertainties"] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 8) return null;
  const dates = new Set(dossier.horizon.remainingDates);
  const parsed: WeeklyPlanningDecision["uncertainties"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim().slice(0, 240) : "";
    if (!text || !namesAreGrounded(text, corpus)) return null;
    const businessDate = record.businessDate == null ? null : String(record.businessDate);
    if (businessDate && !dates.has(businessDate)) return null;
    const status = record.status;
    if (status !== "open" && status !== "resolved" && status !== "killed") return null;
    parsed.push({ text, businessDate, status });
  }
  return parsed;
}

function parseDraftDays(
  value: unknown,
  dossier: WeeklyDossier,
  corpus: string
): WeeklyDraftDayPatch[] | null | undefined {
  if (value == null) return null;
  if (!Array.isArray(value)) return undefined;
  const dates = new Set(dossier.horizon.remainingDates);
  const days: WeeklyDraftDayPatch[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    const businessDate = typeof record.businessDate === "string" ? record.businessDate : "";
    if (!dates.has(businessDate)) return undefined;
    const patch: WeeklyDraftDayPatch = { businessDate };
    if (typeof record.primaryText === "string" && record.primaryText.trim()) {
      const primaryText = record.primaryText.trim().slice(0, 255);
      if (!corpus.includes(primaryText.toLowerCase())) return undefined;
      patch.primaryText = primaryText;
    }
    if (record.readiness != null) {
      if (!Array.isArray(record.readiness) || record.readiness.length > 4) return undefined;
      patch.readiness = [];
      for (const readiness of record.readiness) {
        if (!readiness || typeof readiness !== "object") return undefined;
        const row = readiness as Record<string, unknown>;
        const text = typeof row.text === "string" ? row.text.trim().slice(0, 255) : "";
        if (!text || !corpus.includes(text.toLowerCase())) return undefined;
        if (row.kind != null && !isReadinessKind(row.kind)) return undefined;
        const completeByDate = typeof row.completeByDate === "string" ? row.completeByDate : null;
        if (completeByDate && !/^\d{4}-\d{2}-\d{2}$/.test(completeByDate)) return undefined;
        patch.readiness.push({ text, completeByDate });
      }
    }
    days.push(patch);
  }
  return days;
}

function guardSpeech(speech: string, dossier: WeeklyDossier): string {
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

function namesAreGrounded(speech: string, corpus: string): boolean {
  const proper = speech.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/g) ?? [];
  return proper.every(name => corpus.includes(name.toLowerCase()));
}

function clocksAreGrounded(speech: string, corpus: string): boolean {
  const clocks = speech.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) ?? [];
  return clocks.every(clock => corpus.includes(clock));
}

function addressesAreGrounded(speech: string, corpus: string): boolean {
  const addresses =
    speech.match(/\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr)\b/g) ??
    [];
  return addresses.every(address => corpus.includes(address.toLowerCase()));
}

function asksToRestateKnown(speech: string, dossier: WeeklyDossier): boolean {
  if (!/\b(what time|when is|restate|repeat the window)\b/i.test(speech)) return false;
  const lower = speech.toLowerCase();
  return dossier.fixedConstraints.some(
    item => lower.includes(item.title.toLowerCase()) || lower.includes(item.scheduleLabel.toLowerCase())
  );
}

export function weekIsDefensible(draft: WeeklyDraft, dossier: WeeklyDossier): boolean {
  for (const businessDate of dossier.horizon.remainingDates) {
    const day = draft.days.find(item => item.businessDate === businessDate);
    if (!day) return false;
    if (day.disposition !== "stand_down" && !day.primary?.text) return false;
    if (day.readinessRequirements.length > 4) return false;
    for (const item of day.readinessRequirements) {
      if (item.completeByDate > item.neededForDate) return false;
    }
    const required = dossier.fixedConstraints.filter(item => item.businessDate === businessDate);
    for (const constraint of required) {
      if (!day.fixedConstraints.some(item => item.sourceRef === constraint.sourceRef)) return false;
    }
  }
  return dossier.horizon.remainingDates.length > 0;
}

function previewDraft(
  draft: WeeklyDraft,
  patches: WeeklyDraftDayPatch[] | null,
  candidates?: readonly WeeklyExecutionCandidateContract[]
): WeeklyDraft {
  const next = structuredClone(draft);
  for (const patch of patches ?? []) {
    const day = next.days.find(item => item.businessDate === patch.businessDate);
    if (!day || day.disposition === "stand_down") continue;
    if (patch.primaryText) {
      day.primary = {
        text: patch.primaryText,
        source: "operator_stated",
        existingCommitmentId: day.primary?.existingCommitmentId ?? null,
        executionType: resolveWeeklyExecutionType({ text: patch.primaryText, candidates }),
      };
    }
    if (patch.readiness) {
      day.readinessRequirements = capReadiness(
        patch.readiness.map(item =>
          defaultReadiness({
            text: item.text,
            neededForDate: day.businessDate,
            completeByDate: item.completeByDate ?? undefined,
            executionType: day.primary?.executionType ?? null,
          })
        )
      );
    }
  }
  return next;
}
