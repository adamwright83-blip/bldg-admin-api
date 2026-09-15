import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import type { DayDirectorProposal } from "../../shared/dayDirector";
import {
  acceptProposal,
  getDayDirectorState,
  proposeCommitment,
  updateDayDirectorCommitment,
} from "../dayDirector/dayDirectorService";
import { getClaireCampaignSummary, type ClaireCampaignSummary } from "./campaignAwareness";
import {
  assessAmbiguity,
  classifyIntentHeuristics,
  detectAvoidanceDisclosure,
  extractConversationalFieldOutcome,
  inferBlockerKind,
  matchOpenWorkTitle,
  nextBlockerQuestion,
  nextReadinessPrompt,
  parseScheduleFromUtterance,
  speakFieldCaptureReadback,
  type BlockerKind,
  type ConversationalFieldOutcome,
  type WorkClassificationV1,
} from "../../shared/claireRuntime";
import { recordClaireConversionJoin } from "./conversionJoins";
import { confirmTomorrowUtterance } from "../../shared/claireWorkday";

/**
 * The only place a live Claire phone conversation may cause a durable
 * business commitment.
 *
 * Confirmation parsing (yes/no/ambiguous) is deterministic regex — the
 * model is never trusted to decide whether a mutation happens. That gate
 * is unchanged and is the actual safety boundary.
 *
 * Whether a statement IS new work, already-existing campaign work, or not
 * work at all is NOT decided by regex as the source of truth (production
 * evidence showed phrase-matching missing genuinely new work and
 * mis-classifying existing work whose wording didn't match a fixed verb
 * list). It's decided by a bounded LLM classification grounded in the
 * real, authoritative campaign summary (getClaireCampaignSummary) — never
 * invented, and never itself allowed to mutate anything. A conservative
 * regex fast-path remains only as a supplemental safety net for the
 * clearest possible new-work phrasing, so a classifier outage doesn't
 * silently disable the whole feature.
 */

const CLEAR_ADD_WORK_FAST_PATH =
  /\b(add (?:a|this) (?:task|to-do|commitment)|make a note|remind me to|put (?:this|that) on (?:my|the) list)\b/i;

const YES_PATTERN = /\b(yes|yeah|yep|confirm|confirmed|correct|do it|go ahead|add it|save it)\b/i;
const NO_PATTERN = /\b(no|nope|nah|cancel|never ?mind|don'?t|do not|stop|not now)\b/i;

export function detectConfirmation(utterance: string): "yes" | "no" | "ambiguous" {
  const hasYes = YES_PATTERN.test(utterance);
  const hasNo = NO_PATTERN.test(utterance);
  if (hasYes && !hasNo) return "yes";
  if (hasNo && !hasYes) return "no";
  return "ambiguous";
}

export function describeProposalForReadback(proposal: DayDirectorProposal): string {
  const quantityPart = proposal.quantity ? `, quantity ${proposal.quantity}` : "";
  const detailPart =
    proposal.detailState === "NEEDS_DETAILS"
      ? " I can add it now and flag the missing details."
      : "";
  return `I heard: ${proposal.title}${quantityPart}.${detailPart} Should I add that to today's plan? Say yes or no.`;
}

const classificationSchema = z.object({
  classification: z.enum([
    "new_work",
    "existing_work",
    "update_existing_work",
    "fyi_context",
    "uncertain",
    "not_work",
  ]),
  reason: z.string().max(200),
});

const CLASSIFY_JSON_SCHEMA = {
  name: "claire_work_classification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      classification: {
        type: "string",
        enum: [
          "new_work",
          "existing_work",
          "update_existing_work",
          "fyi_context",
          "uncertain",
          "not_work",
        ],
      },
      reason: { type: "string", maxLength: 200 },
    },
    required: ["classification", "reason"],
  },
} as const;

function contentText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const value = result.choices[0]?.message?.content;
  return typeof value === "string" ? value : "";
}

export type WorkClassification = WorkClassificationV1;

/**
 * Grounded in real campaign state, not phrase-matching. Fails closed to
 * "not_work" on any error — a classifier failure must never silently
 * mutate anything, it just means Claire won't offer to add it that turn
 * (ordinary conversation still proceeds normally). "uncertain" is a
 * distinct, honest outcome — genuinely ambiguous phrasing should produce a
 * clarifying question, not be silently swallowed into generic Q&A and not
 * be guessed into a mutation either.
 */
export async function classifyVoiceWorkStatement(
  input: {
    tenantId: string;
    utterance: string;
    campaignSummary: ClaireCampaignSummary | null;
  },
  dependencies: { invoke?: typeof invokeLLM } = {}
): Promise<WorkClassification> {
  if (CLEAR_ADD_WORK_FAST_PATH.test(input.utterance)) return "new_work";
  const heuristic = classifyIntentHeuristics(input.utterance);
  if (heuristic) return heuristic;
  const invoke = dependencies.invoke ?? invokeLLM;
  try {
    const result = await invoke({
      tenantId: input.tenantId,
      maxTokens: 150,
      temperature: 0,
      outputSchema: CLASSIFY_JSON_SCHEMA,
      messages: [
        {
          role: "system",
          content: [
            "Classify the operator's statement into exactly one category: new_work, existing_work, update_existing_work, fyi_context, uncertain, or not_work.",
            "new_work: describes or requests adding a task/decision/action the system does not already track. Secondary missing details (deadline, criteria) do NOT make this uncertain — that is still new_work.",
            "existing_work: describes work that already belongs to a named ongoing campaign/mission/challenge, or references progress/remaining/completed count on something already tracked.",
            "update_existing_work: asks to change timing, details, or status of work that already exists, not to create a copy.",
            "fyi_context: catching Claire up, frustration, background, with no action request.",
            "uncertain: you genuinely cannot tell whether the user wants an action, what action, what target, or what consequential effect is intended.",
            "not_work: a question, small talk, or anything clearly not describing actionable work at all.",
            "Prefer uncertain over guessing when genuinely unclear — never silently classify unclear statements as not_work merely because the wording doesn't match a fixed phrase.",
            input.campaignSummary
              ? input.campaignSummary.active
                ? `Authoritative campaign state: an active field-sales campaign currently has ${input.campaignSummary.remainingCount} real stops remaining and ${input.campaignSummary.completedCount} completed. If the statement describes visiting or pitching more stops of that same kind, classify existing_work.`
                : "Authoritative campaign state: no active field-sales campaign."
              : "No campaign state is available.",
            "Never invent facts. Classify only from what the operator said and the authoritative state above.",
          ].join(" "),
        },
        { role: "user", content: input.utterance },
      ],
    });
    const parsed = classificationSchema.safeParse(JSON.parse(contentText(result)));
    return parsed.success ? parsed.data.classification : "not_work";
  } catch (error) {
    console.warn("[Claire] voice work classification failed, treating as not_work", error);
    return "not_work";
  }
}

/**
 * A single empty Twilio speech result (silence, or the caller still
 * formulating a sentence right after a short response like "Added: X.")
 * must never end the call by itself — production evidence showed this
 * happening while the operator still had more to say. Only two
 * consecutive empty results end the call; any real transcript resets the
 * counter (call trackNonEmptyTranscript on that path).
 */
export function trackEmptyTranscript(state: { consecutiveEmptyTranscripts?: number }): {
  shouldEndCall: boolean;
} {
  state.consecutiveEmptyTranscripts = (state.consecutiveEmptyTranscripts ?? 0) + 1;
  return { shouldEndCall: state.consecutiveEmptyTranscripts >= 2 };
}

export function trackNonEmptyTranscript(state: { consecutiveEmptyTranscripts?: number }): void {
  state.consecutiveEmptyTranscripts = 0;
}

export type PendingProposalState = {
  pendingProposal?: DayDirectorProposal | null;
  /** An utterance whose new-vs-existing-work status was ambiguous; awaiting the operator's clarifying reply. */
  clarifyingUtterance?: string | null;
  pendingUpdate?: {
    commitmentId: string;
    title: string;
    patch: {
      detailState?: "COMPLETE" | "NEEDS_DETAILS";
      missingDetails?: string[];
      detailNote?: string | null;
      scheduleKind?: string;
      scheduleLabel?: string | null;
    };
  } | null;
  pendingFieldCapture?: ConversationalFieldOutcome | null;
  lastAcceptedCommitmentId?: string | null;
  blockerKind?: BlockerKind | null;
  sessionKind?: "evening_planning" | "morning_reconciliation" | "field_debrief" | "pre_drive";
};

export type VoiceCommitmentTurnResult =
  | { kind: "proposed"; speak: string }
  | { kind: "accepted"; speak: string; proposal: DayDirectorProposal }
  | { kind: "updated"; speak: string; commitmentId: string }
  | { kind: "declined"; speak: string }
  | { kind: "reask"; speak: string }
  | { kind: "acknowledged_existing"; speak: string }
  | { kind: "clarifying"; speak: string }
  | { kind: "coaching"; speak: string }
  | { kind: "field_captured"; speak: string }
  | { kind: "plan_confirmed"; speak: string }
  | { kind: "not_applicable" };

export async function handleVoiceCommitmentTurn(
  input: {
    tenantId: string;
    actorId: string;
    businessDate: string;
    utterance: string;
    state: PendingProposalState;
    conversationId?: string;
  },
  dependencies: {
    propose?: typeof proposeCommitment;
    accept?: typeof acceptProposal;
    classify?: typeof classifyVoiceWorkStatement;
    getCampaignSummary?: typeof getClaireCampaignSummary;
    getState?: typeof getDayDirectorState;
    updateCommitment?: typeof updateDayDirectorCommitment;
    persistFieldCapture?: (outcome: ConversationalFieldOutcome) => Promise<{ ok: boolean; id?: string }>;
    confirmPlan?: () => Promise<void>;
  } = {}
): Promise<VoiceCommitmentTurnResult> {
  const propose = dependencies.propose ?? proposeCommitment;
  const accept = dependencies.accept ?? acceptProposal;
  const classify = dependencies.classify ?? classifyVoiceWorkStatement;
  const getCampaignSummary = dependencies.getCampaignSummary ?? getClaireCampaignSummary;
  const getState = dependencies.getState ?? getDayDirectorState;
  const updateCommitment = dependencies.updateCommitment ?? updateDayDirectorCommitment;

  if (input.state.pendingProposal) {
    const proposal = input.state.pendingProposal;
    const decision = detectConfirmation(input.utterance);
    if (decision === "yes") {
      input.state.pendingProposal = null;
      const stored = await accept({
        tenantId: input.tenantId,
        actorId: input.actorId,
        businessDate: input.businessDate,
        proposal,
      });
      const storedId =
        stored && typeof stored === "object" && "id" in stored
          ? String((stored as { id?: unknown }).id ?? "")
          : "";
      if (storedId) input.state.lastAcceptedCommitmentId = storedId;
      recordClaireConversionJoin({
        tenantId: input.tenantId,
        operatorUserId: input.actorId,
        conversationId: input.conversationId,
        stage: "accepted",
        actionId: storedId || null,
        proposalTitle: proposal.title,
        detailState: proposal.detailState ?? "COMPLETE",
      });
      return {
        kind: "accepted",
        speak:
          proposal.detailState === "NEEDS_DETAILS"
            ? `Added: ${proposal.title}. I flagged it because we still need ${(proposal.missingDetails ?? []).join(" and ") || "a couple of details"}. What else?`
            : `Added: ${proposal.title}. What else?`,
        proposal,
      };
    }
    if (decision === "no") {
      input.state.pendingProposal = null;
      return { kind: "declined", speak: "Okay, I won't add that. Anything else?" };
    }
    return {
      kind: "reask",
      speak: `Sorry — should I add "${proposal.title}"? Say yes or no.`,
    };
  }

  if (input.state.pendingUpdate) {
    const pending = input.state.pendingUpdate;
    const decision = detectConfirmation(input.utterance);
    if (decision === "yes") {
      input.state.pendingUpdate = null;
      await updateCommitment({
        tenantId: input.tenantId,
        actorId: input.actorId,
        commitmentId: pending.commitmentId,
        patch: pending.patch,
      });
      recordClaireConversionJoin({
        tenantId: input.tenantId,
        operatorUserId: input.actorId,
        conversationId: input.conversationId,
        stage: "details_supplied",
        actionId: pending.commitmentId,
        proposalTitle: pending.title,
        detailState: pending.patch.detailState ?? "COMPLETE",
      });
      return {
        kind: "updated",
        speak: `Updated: ${pending.title}. Same item, no duplicate. What else?`,
        commitmentId: pending.commitmentId,
      };
    }
    if (decision === "no") {
      input.state.pendingUpdate = null;
      return { kind: "declined", speak: "Okay, I won't change that. Anything else?" };
    }
    return {
      kind: "reask",
      speak: `Sorry — should I update "${pending.title}"? Say yes or no.`,
    };
  }

  if (input.state.pendingFieldCapture) {
    const pending = input.state.pendingFieldCapture;
    const decision = detectConfirmation(input.utterance);
    if (decision === "yes") {
      input.state.pendingFieldCapture = null;
      const persist =
        dependencies.persistFieldCapture ??
        (async (outcome: ConversationalFieldOutcome) => {
          if (!input.state.lastAcceptedCommitmentId) {
            const proposal = await propose({
              tenantId: input.tenantId,
              sourceText: outcome.rawUtterance,
            });
            proposal.title = `Field outcome: ${outcome.attestedFacts[0] ?? "operator-attested visit"}`.slice(
              0,
              255
            );
            proposal.detailNote = JSON.stringify({
              fieldOutcome: outcome,
              hearsay: outcome.hearsay,
            });
            const stored = await accept({
              tenantId: input.tenantId,
              actorId: input.actorId,
              businessDate: input.businessDate,
              proposal,
            });
            const id =
              stored && typeof stored === "object" && "id" in stored
                ? String((stored as { id?: unknown }).id ?? "")
                : "";
            return { ok: true, id };
          }
          await updateCommitment({
            tenantId: input.tenantId,
            actorId: input.actorId,
            commitmentId: input.state.lastAcceptedCommitmentId,
            patch: {
              detailNote: JSON.stringify({
                fieldOutcome: pending,
                hearsay: pending.hearsay,
              }),
            },
          });
          return { ok: true, id: input.state.lastAcceptedCommitmentId };
        });
      const saved = await persist(pending);
      if (!saved.ok) {
        return {
          kind: "clarifying",
          speak: "I understood it, but I couldn't save it. Let's try again in a moment.",
        };
      }
      recordClaireConversionJoin({
        tenantId: input.tenantId,
        operatorUserId: input.actorId,
        conversationId: input.conversationId,
        stage: "outcome",
        actionId: saved.id ?? null,
        outcomeId: saved.id ?? null,
        proposalTitle: pending.attestedFacts[0] ?? "field outcome",
      });
      return {
        kind: "field_captured",
        speak: "Saved as operator-attested. Hearsay stayed hearsay. What else?",
      };
    }
    if (decision === "no") {
      input.state.pendingFieldCapture = null;
      return { kind: "declined", speak: "Okay, I won't record that. Anything else?" };
    }
    return {
      kind: "reask",
      speak: "Sorry — should I save that field outcome? Say yes or no.",
    };
  }

  if (input.state.clarifyingUtterance) {
    const original = input.state.clarifyingUtterance;
    const decision = detectConfirmation(input.utterance);
    if (decision === "yes") {
      input.state.clarifyingUtterance = null;
      const proposal = await propose({ tenantId: input.tenantId, sourceText: original });
      input.state.pendingProposal = proposal;
      recordClaireConversionJoin({
        tenantId: input.tenantId,
        operatorUserId: input.actorId,
        conversationId: input.conversationId,
        stage: "proposal",
        proposalTitle: proposal.title,
        detailState: proposal.detailState ?? "COMPLETE",
      });
      return { kind: "proposed", speak: describeProposalForReadback(proposal) };
    }
    if (decision === "no") {
      input.state.clarifyingUtterance = null;
      return { kind: "declined", speak: "Got it — just keeping me posted, then. Anything else?" };
    }
    return {
      kind: "clarifying",
      speak: "Sorry — do you want me to add that as work, or were you just catching me up?",
    };
  }

  if (detectAvoidanceDisclosure(input.utterance)) {
    const kind = inferBlockerKind(input.utterance);
    input.state.blockerKind = kind;
    return {
      kind: "coaching",
      speak: `${nextBlockerQuestion(kind)} ${nextReadinessPrompt(kind)}`.trim(),
    };
  }

  if (
    (confirmTomorrowUtterance(input.utterance) ||
      (input.state.sessionKind === "evening_planning" &&
        detectConfirmation(input.utterance) === "yes")) &&
    dependencies.confirmPlan
  ) {
    await dependencies.confirmPlan();
    return {
      kind: "plan_confirmed",
      speak: "Tomorrow is confirmed. I'll reconcile any overnight changes in the morning.",
    };
  }

  const fieldOutcome = extractConversationalFieldOutcome(input.utterance);
  if (fieldOutcome) {
    input.state.pendingFieldCapture = fieldOutcome;
    return { kind: "clarifying", speak: speakFieldCaptureReadback(fieldOutcome) };
  }

  const campaignSummary = await getCampaignSummary({
    tenantId: input.tenantId,
    actorId: input.actorId,
  });
  const classification = await classify({
    tenantId: input.tenantId,
    utterance: input.utterance,
    campaignSummary,
  });

  if (classification === "not_work") {
    return { kind: "not_applicable" };
  }

  if (classification === "uncertain") {
    input.state.clarifyingUtterance = input.utterance;
    return {
      kind: "clarifying",
      speak: "Do you want me to add something, change something, or are you just catching me up?",
    };
  }

  if (classification === "fyi_context") {
    return { kind: "not_applicable" };
  }

  if (classification === "update_existing_work") {
    const state = await getState({
      tenantId: input.tenantId,
      actorId: input.actorId,
      businessDate: input.businessDate,
    });
    const open = (state.commitments ?? []).filter(item => item.status === "open");
    const match =
      open.find(item => matchOpenWorkTitle(item.title, input.utterance)) ??
      open.find(item => item.id === input.state.lastAcceptedCommitmentId) ??
      open.find(item => item.detailState === "NEEDS_DETAILS");
    if (match) {
      const schedule = parseScheduleFromUtterance(input.utterance, new Date());
      const completingDetails = Boolean(match.detailState === "NEEDS_DETAILS");
      input.state.pendingUpdate = {
        commitmentId: match.id,
        title: match.title,
        patch: {
          detailState: completingDetails ? "COMPLETE" : match.detailState,
          missingDetails: completingDetails ? [] : match.missingDetails,
          detailNote: completingDetails ? "Details supplied by operator" : match.detailNote,
          scheduleKind: schedule.kind,
          scheduleLabel: schedule.label,
        },
      };
      return {
        kind: "clarifying",
        speak: `I can update "${match.title}" in place — no duplicate.${
          completingDetails ? " That would clear the missing-details flag." : ""
        } Say yes or no.`,
      };
    }
    return {
      kind: "acknowledged_existing",
      speak:
        "I can update the existing work rather than add a copy. If this is campaign field work, I won't duplicate the visits — tell me the timing change and confirm yes.",
    };
  }

  if (classification === "existing_work") {
    return {
      kind: "acknowledged_existing",
      speak:
        "Those already exist under that campaign, so I don't need to add them again. Want me to change when they surface, or are you just flagging it?",
    };
  }

  const ambiguity = assessAmbiguity(input.utterance);
  if (ambiguity.blocksExecution) {
    return {
      kind: "clarifying",
      speak: `I can't execute that yet. I need the ${ambiguity.missingDetails.join(" and ")}.`,
    };
  }

  const proposal = await propose({
    tenantId: input.tenantId,
    sourceText: input.utterance,
  });
  if (ambiguity.kind === "non_critical") {
    proposal.detailState = "NEEDS_DETAILS";
    proposal.missingDetails = ambiguity.missingDetails;
    proposal.detailNote = "Preserved with incomplete details";
  }
  const schedule = parseScheduleFromUtterance(input.utterance, new Date());
  if (schedule.kind !== "UNSCHEDULED") {
    proposal.detailNote = [proposal.detailNote, schedule.label].filter(Boolean).join(" · ");
  }
  input.state.pendingProposal = proposal;
  recordClaireConversionJoin({
    tenantId: input.tenantId,
    operatorUserId: input.actorId,
    conversationId: input.conversationId,
    stage: "proposal",
    proposalTitle: proposal.title,
    detailState: proposal.detailState ?? "COMPLETE",
  });
  return { kind: "proposed", speak: describeProposalForReadback(proposal) };
}
