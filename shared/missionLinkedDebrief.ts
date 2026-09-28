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
  /** A second missing fact is collected only after the first is answered. */
  additionalQuestion: MissionDebriefQuestion | null;
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

function requestedEmailMaterial(extraction: FieldJournalExtraction) {
  return extraction.followUps.find(item => {
    const text = textOf(item.requestedAction);
    return /\b(email|send)\b/i.test(text) &&
      /\b(packet|collateral|proposal|pricing|information|info|materials?)\b/i.test(text);
  }) ?? null;
}

function groundedEmail(
  extraction: FieldJournalExtraction,
  entityClientKey: string | null
): string | null {
  const entities = entityClientKey
    ? extraction.entities.filter(entity => entity.clientEntityKey === entityClientKey)
    : extraction.entities;
  for (const entity of entities) {
    const candidate = entity.email?.value?.trim();
    if (candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return candidate;
  }
  return null;
}

const DECISION_MAKER_TITLE =
  /\b(?:general|property|community|building)\s+manager\b|\b(?:owner|director|decision[- ]maker)\b/i;

function explicitlyMetDecisionMaker(extraction: FieldJournalExtraction): boolean {
  const entities = new Map(
    extraction.entities.map(entity => [entity.clientEntityKey, entity])
  );
  return extraction.actions.some(action => {
    if (action.type !== "spoke_with_contact") return false;
    const spokenEvidence = textOf(action.evidence);
    if (DECISION_MAKER_TITLE.test(spokenEvidence)) return true;
    if (!action.entityClientKey) return false;
    const entity = entities.get(action.entityClientKey);
    const title = entity?.contactTitle ? textOf(entity.contactTitle) : "";
    return DECISION_MAKER_TITLE.test(title);
  });
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
  const evidenceItems = [
    ...extraction.outcomes.map(item => textOf(item.evidence)),
    ...extraction.actions.map(item => textOf(item.evidence)),
    ...extraction.followUps.map(item => textOf(item.requestedAction)),
  ];

  const managerUnavailable = hasOutcome(extraction, "manager_unavailable");
  const askedToReturn = hasOutcome(extraction, "asked_to_return");
  let outcome: FieldVisitOutcome = "no_decision";
  let reason: FieldOutcomeReason | undefined;
  if (hasOutcome(extraction, "account_won_reported") || hasOutcome(extraction, "verbal_yes_reported")) {
    outcome = "won";
  } else if (hasOutcome(extraction, "account_lost_reported") || hasOutcome(extraction, "declined")) {
    outcome = "lost";
    reason = hasOutcome(extraction, "declined") ? "no_interest" : "other";
  } else if (askedToReturn) {
    // A blocked visit can still produce an explicit next move. Preserve that
    // return request rather than collapsing the encounter to no_contact.
    outcome = "follow_up";
  } else if (managerUnavailable) {
    outcome = "no_contact";
  }

  const quoteRequested = hasOutcome(extraction, "proposal_requested") ||
    evidenceItems.some(text =>
      /\b(quote|pricing|proposal)\b/i.test(text) &&
      /\b(asked|requested|send|email|wants?)\b/i.test(text)
    );
  const pilotRequested = evidenceItems.some(text =>
    /\bpilot\b/i.test(text) &&
    /\b(asked|requested|wants?|try|trial)\b/i.test(text)
  );
  const followUpRequested =
    outcome === "follow_up" ||
    quoteRequested ||
    extraction.followUps.length > 0;
  const collateralDelivered = actions.has("collateral_delivered");
  const decisionMakerStatus =
    explicitlyMetDecisionMaker(extraction)
      ? "met" as const
      : managerUnavailable
        ? "unavailable" as const
        : "not_recorded" as const;

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

  const questions: MissionDebriefQuestion[] = [];
  if (outcome === "follow_up") {
    questions.push({
      kind: "follow_up_at",
      prompt: "When did they ask you to come back or follow up?",
      inputType: "datetime-local",
    });
  }
  if (emailDraft && !emailDraft.to) {
    questions.push({
      kind: "email",
      prompt: "What email did they give you?",
      inputType: "email",
    });
  }
  const question = questions[0] ?? null;
  const additionalQuestion = questions[1] ?? null;

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
    additionalQuestion,
    emailDraft,
  };
}
