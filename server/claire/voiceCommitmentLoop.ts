import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import type { DayDirectorProposal } from "../../shared/dayDirector";
import { acceptProposal, proposeCommitment } from "../dayDirector/dayDirectorService";
import { getClaireCampaignSummary, type ClaireCampaignSummary } from "./campaignAwareness";

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
  return `I heard: ${proposal.title}${quantityPart}. Should I add that to today's plan? Say yes or no.`;
}

const classificationSchema = z.object({
  classification: z.enum(["new_work", "existing_work", "uncertain", "not_work"]),
  reason: z.string().max(200),
});

const CLASSIFY_JSON_SCHEMA = {
  name: "claire_work_classification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      classification: { type: "string", enum: ["new_work", "existing_work", "uncertain", "not_work"] },
      reason: { type: "string", maxLength: 200 },
    },
    required: ["classification", "reason"],
  },
} as const;

function contentText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const value = result.choices[0]?.message?.content;
  return typeof value === "string" ? value : "";
}

export type WorkClassification = "new_work" | "existing_work" | "uncertain" | "not_work";

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
            "Classify the operator's statement into exactly one category: new_work, existing_work, uncertain, or not_work.",
            "new_work: describes or requests adding a task/decision/action the system does not already track — however it's phrased ('I need to figure out...', 'put this on my radar', 'another thing I have to do', 'there's something else', 'oh, and I forgot', 'Russell also wants me to...', etc).",
            "existing_work: describes work that already belongs to a named ongoing campaign/mission/challenge, or references progress/remaining/completed count on something already tracked.",
            "uncertain: the statement plausibly could be new work OR could just be the operator catching Claire up / thinking out loud, and you genuinely cannot tell which from the wording alone.",
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
};

export type VoiceCommitmentTurnResult =
  | { kind: "proposed"; speak: string }
  | { kind: "accepted"; speak: string; proposal: DayDirectorProposal }
  | { kind: "declined"; speak: string }
  | { kind: "reask"; speak: string }
  | { kind: "acknowledged_existing"; speak: string }
  | { kind: "clarifying"; speak: string }
  | { kind: "not_applicable" };

export async function handleVoiceCommitmentTurn(
  input: {
    tenantId: string;
    actorId: string;
    businessDate: string;
    utterance: string;
    state: PendingProposalState;
  },
  dependencies: {
    propose?: typeof proposeCommitment;
    accept?: typeof acceptProposal;
    classify?: typeof classifyVoiceWorkStatement;
    getCampaignSummary?: typeof getClaireCampaignSummary;
  } = {}
): Promise<VoiceCommitmentTurnResult> {
  const propose = dependencies.propose ?? proposeCommitment;
  const accept = dependencies.accept ?? acceptProposal;
  const classify = dependencies.classify ?? classifyVoiceWorkStatement;
  const getCampaignSummary = dependencies.getCampaignSummary ?? getClaireCampaignSummary;

  if (input.state.pendingProposal) {
    const proposal = input.state.pendingProposal;
    const decision = detectConfirmation(input.utterance);
    if (decision === "yes") {
      // Cleared synchronously, before the first await, so a duplicate
      // Twilio delivery arriving for the same turn can never see a
      // pending proposal to re-confirm — it falls through to ordinary
      // conversation instead. acceptProposal's own idempotencyKey
      // (derived from the verbatim source text) is the second,
      // DB-level line of defense against a duplicate commitment.
      input.state.pendingProposal = null;
      await accept({
        tenantId: input.tenantId,
        actorId: input.actorId,
        businessDate: input.businessDate,
        proposal,
      });
      // A successful mutation is never a terminal conversation state —
      // production evidence showed a terse "Added: X." with no invitation
      // to continue led to the call ending on the next silence. Always
      // hand the turn back.
      return { kind: "accepted", speak: `Added: ${proposal.title}. What else?`, proposal };
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

  if (input.state.clarifyingUtterance) {
    const original = input.state.clarifyingUtterance;
    const decision = detectConfirmation(input.utterance);
    if (decision === "yes") {
      input.state.clarifyingUtterance = null;
      const proposal = await propose({ tenantId: input.tenantId, sourceText: original });
      input.state.pendingProposal = proposal;
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
    // Fail-closed means NO MUTATION WITHOUT CONFIDENCE — it does not mean
    // dumping an unclear statement into generic Q&A. Ask, don't guess.
    input.state.clarifyingUtterance = input.utterance;
    return {
      kind: "clarifying",
      speak: "Do you want me to add that, or are you just catching me up?",
    };
  }

  if (classification === "existing_work") {
    // Authoritative campaign state already covers this — never duplicate
    // it into a new Day Director commitment merely because it was said.
    return {
      kind: "acknowledged_existing",
      speak:
        "Those already exist under that campaign, so I don't need to add them again. Want me to change when they surface, or are you just flagging it?",
    };
  }

  const proposal = await propose({
    tenantId: input.tenantId,
    sourceText: input.utterance,
  });
  input.state.pendingProposal = proposal;
  return { kind: "proposed", speak: describeProposalForReadback(proposal) };
}
