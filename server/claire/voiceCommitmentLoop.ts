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
  classification: z.enum(["new_work", "existing_work", "not_work"]),
  reason: z.string().max(200),
});

const CLASSIFY_JSON_SCHEMA = {
  name: "claire_work_classification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      classification: { type: "string", enum: ["new_work", "existing_work", "not_work"] },
      reason: { type: "string", maxLength: 200 },
    },
    required: ["classification", "reason"],
  },
} as const;

function contentText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const value = result.choices[0]?.message?.content;
  return typeof value === "string" ? value : "";
}

export type WorkClassification = "new_work" | "existing_work" | "not_work";

/**
 * Grounded in real campaign state, not phrase-matching. Fails closed to
 * "not_work" on any error — a classifier failure must never silently
 * mutate anything, it just means Claire won't offer to add it that turn
 * (ordinary conversation still proceeds normally).
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
            "Classify the operator's statement into exactly one category: new_work, existing_work, or not_work.",
            "new_work: describes or requests adding a task/decision/action the system does not already track.",
            "existing_work: describes work that already belongs to a named ongoing campaign/mission/challenge, or references progress/remaining/completed count on something already tracked — even if phrased as 'I have to' or 'I need to'.",
            "not_work: a question, small talk, or anything not describing actionable work.",
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

export type PendingProposalState = { pendingProposal?: DayDirectorProposal | null };

export type VoiceCommitmentTurnResult =
  | { kind: "proposed"; speak: string }
  | { kind: "accepted"; speak: string; proposal: DayDirectorProposal }
  | { kind: "declined"; speak: string }
  | { kind: "reask"; speak: string }
  | { kind: "acknowledged_existing"; speak: string }
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
      return { kind: "accepted", speak: `Added: ${proposal.title}.`, proposal };
    }
    if (decision === "no") {
      input.state.pendingProposal = null;
      return { kind: "declined", speak: "Okay, I won't add that." };
    }
    return {
      kind: "reask",
      speak: `Sorry — should I add "${proposal.title}"? Say yes or no.`,
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

  if (classification === "existing_work") {
    // Authoritative campaign state already covers this — never duplicate
    // it into a new Day Director commitment merely because it was said.
    return {
      kind: "acknowledged_existing",
      speak: "Those already exist under that campaign. I don't need to add them again.",
    };
  }

  const proposal = await propose({
    tenantId: input.tenantId,
    sourceText: input.utterance,
  });
  input.state.pendingProposal = proposal;
  return { kind: "proposed", speak: describeProposalForReadback(proposal) };
}
