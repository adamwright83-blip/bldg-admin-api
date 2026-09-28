import type { FieldJournalExtraction } from "./fieldJournal";
import type { FieldOutcomeReason, FieldVisitOutcome } from "./commercialMissionField";

export type MissionDebriefQuestion = {
  kind: "follow_up_at" | "email";
  prompt: string;
  inputType: "datetime-local" | "email";
};

export type MissionDebriefEmailDraft = {
  to: string | null;
  subject: string;
  body: string;
  sendAuthorized: false;
};

export type MissionDebriefProposal = {
  outcome: FieldVisitOutcome;
  reason?: FieldOutcomeReason;
  decisionMakerStatus: "met" | "unavailable" | "not_recorded";
  collateralDelivered: boolean;
  quoteRequested: boolean;
  pilotRequested: boolean;
  followUpRequested: boolean;
  summary: string;
  question: MissionDebriefQuestion | null;
  emailDraft: MissionDebriefEmailDraft | null;
};

export type MissionLinkedDebriefState =
  | { status: "not_started"; missionId: number }
  | { status: "processing"; missionId: number; journalEntryId: string }
  | {
      status: "failed";
      missionId: number;
      journalEntryId: string;
      message: string;
    }
  | {
      status: "ready";
      missionId: number;
      journalEntryId: string;
      transcript: string;
      proposal: MissionDebriefProposal;
    }
  | {
      status: "completed";
      missionId: number;
      journalEntryId: string | null;
      outcome: FieldVisitOutcome;
      emailDraft: MissionDebriefEmailDraft | null;
    };

const textOf = (value: { value: string; transcriptExcerpt: string | null }) =>
  `${value.value} ${value.transcriptExcerpt ?? ""}`;

function hasOutcome(extraction: FieldJournalExtraction, type: FieldJournalExtraction["outcomes"][number]["type"]) {
  return extraction.outcomes.some(item => item.type === type && item.explicitlyReported);
}

function requestedEmailMaterial(extraction: FieldJournalExtraction): boolean {
  return extraction.followUps.some(item => {
    const text = textOf(item.requestedAction);
    return /\b(email|send)\b/i.test(text) &&
      /\b(packet|collateral|proposal|pricing|information|info|materials?)\b/i.test(text);
  });
}

function groundedEmail(extraction: FieldJournalExtraction): string | null {
  for (const entity of extraction.entities) {
    const candidate = entity.email?.value?.trim();
    if (candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Converts the already-grounded Field Journal extraction into one proposed
 * commercial visit result. This is not a parser and creates no business truth:
 * the operator must still confirm before the authoritative outcome writer runs.
 */
export function deriveMissionLinkedDebriefProposal(input: {
  extraction: FieldJournalExtraction;
  transcript: string;
  buildingName: string;
  knownEmail?: string | null;
}): MissionDebriefProposal {
  const { extraction, buildingName } = input;
  const actions = new Set(extraction.actions.map(item => item.type));
  const allEvidence = [
    ...extraction.outcomes.map(item => textOf(item.evidence)),
    ...extraction.actions.map(item => textOf(item.evidence)),
    ...extraction.followUps.map(item => textOf(item.requestedAction)),
  ].join(" ");

  let outcome: FieldVisitOutcome = "no_decision";
  let reason: FieldOutcomeReason | undefined;
  if (hasOutcome(extraction, "account_won_reported") || hasOutcome(extraction, "verbal_yes_reported")) {
    outcome = "won";
  } else if (hasOutcome(extraction, "account_lost_reported") || hasOutcome(extraction, "declined")) {
    outcome = "lost";
    reason = hasOutcome(extraction, "declined") ? "no_interest" : "other";
  } else if (hasOutcome(extraction, "manager_unavailable")) {
    outcome = "no_contact";
  } else if (hasOutcome(extraction, "asked_to_return")) {
    outcome = "follow_up";
  }

  const quoteRequested = hasOutcome(extraction, "proposal_requested") ||
    /\b(quote|pricing|proposal)\b/i.test(allEvidence) &&
      /\b(asked|requested|send|email|wants?)\b/i.test(allEvidence);
  const pilotRequested = /\bpilot\b/i.test(allEvidence) &&
    /\b(asked|requested|wants?|try|trial)\b/i.test(allEvidence);
  const followUpRequested =
    outcome === "follow_up" ||
    quoteRequested ||
    extraction.followUps.length > 0;
  const collateralDelivered = actions.has("collateral_delivered");
  const decisionMakerStatus =
    outcome === "no_contact" ? "unavailable" as const : "not_recorded" as const;

  const wantsEmailDraft = requestedEmailMaterial(extraction);
  const email = groundedEmail(extraction) ?? input.knownEmail?.trim() ?? null;
  const emailDraft: MissionDebriefEmailDraft | null = wantsEmailDraft
    ? {
        to: email || null,
        subject: `${buildingName} — laundry service information`,
        body:
          "Thanks for speaking with me today. As requested, here is the laundry service information we discussed. I can answer any questions that come up.",
        sendAuthorized: false,
      }
    : null;

  let question: MissionDebriefQuestion | null = null;
  if (outcome === "follow_up") {
    question = {
      kind: "follow_up_at",
      prompt: "When did they ask you to come back or follow up?",
      inputType: "datetime-local",
    };
  } else if (emailDraft && !emailDraft.to) {
    question = {
      kind: "email",
      prompt: "What email did they give you?",
      inputType: "email",
    };
  }

  const summary =
    outcome === "no_contact"
      ? "The tower is still unresolved. You did not reach the decision maker."
      : outcome === "follow_up"
        ? "They gave you a real next move. Claire needs one timing detail before locking it in."
        : outcome === "won"
          ? "Your account reports a win. Confirm it before Goldline changes the business state."
          : outcome === "lost"
            ? "Your account reports a no. Confirm it before Goldline closes the route."
            : quoteRequested || pilotRequested || followUpRequested
              ? "No decision yet, but the visit produced a concrete next move."
              : "No decision yet. The visit remains unresolved.";

  return {
    outcome,
    ...(reason ? { reason } : {}),
    decisionMakerStatus,
    collateralDelivered,
    quoteRequested,
    pilotRequested,
    followUpRequested,
    summary,
    question,
    emailDraft,
  };
}
