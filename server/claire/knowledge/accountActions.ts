import { createHash } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { acceptProposal } from "../../dayDirector/dayDirectorService";
import {
  rescheduleCommercialFollowUp,
  scheduleCommercialFollowUp,
} from "../../commercialPipeline/commercialPipelineService";
import { dayMention, spokenDay } from "../briefing/briefingTiming";
import type { AccountHistory } from "./accountKnowledge";

/**
 * "I went to The Louise but Dana wasn't there. Front desk says Thursday. Put
 * the follow-up on Thursday."
 *
 * A field report plus a scheduling instruction for a real commercial account.
 * Claire moves the account's actual open follow-up (or schedules one on its
 * pipeline) and puts it on that day's Day Line, keeping what the front desk
 * said as hearsay. Nothing is written until Adam says yes.
 */

export type PendingAccountFollowUp = {
  accountId: number;
  accountName: string;
  pipelineId: number | null;
  followUpId: string | null;
  previousDueAt: string | null;
  dueDate: string;
  /** Operator-attested field report and hearsay, verbatim. */
  note: string;
  requestId: string;
};

export function followUpDayIntent(utterance: string, today: string): { ymd: string } | null {
  const lower = utterance.toLowerCase();
  const instruction = /\b(?:put|move|push|reschedule|set|make|schedule|bump)\b[^.?!]*\bfollow[- ]?up\b[^.?!]*|\bfollow[- ]?up\b[^.?!]*\b(?:on|to|for|by|until)\b[^.?!]*/.exec(lower);
  if (!instruction) return null;
  const mention = dayMention(instruction[0], today);
  return mention && mention.ymd >= today ? { ymd: mention.ymd } : null;
}

export function fieldReportOf(utterance: string): string {
  return utterance
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => !/\b(?:put|move|push|reschedule|set|schedule|bump)\b[^.?!]*\bfollow[- ]?up\b/i.test(sentence))
    .join(" ")
    .trim();
}

export function proposeAccountFollowUp(input: {
  history: AccountHistory;
  utterance: string;
  dueDate: string;
  conversationKey: string;
}): PendingAccountFollowUp {
  const open = input.history.followUps
    .filter(followUp => followUp.status === "open")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return {
    accountId: input.history.account.id,
    accountName: input.history.account.name,
    pipelineId: open?.pipelineId ?? input.history.pipelineId,
    followUpId: open?.id ?? null,
    previousDueAt: open?.dueAt ?? null,
    dueDate: input.dueDate,
    note: fieldReportOf(input.utterance).slice(0, 500),
    requestId: createHash("sha256").update(`${input.conversationKey}|${input.history.account.id}|${input.dueDate}|${input.utterance}`).digest("hex").slice(0, 32),
  };
}

function theAccount(name: string): string {
  return /^the\s/i.test(name) ? name : `the ${name}`;
}

export function speakAccountFollowUpProposal(pending: PendingAccountFollowUp, options: { today: string; timeZone: string }): string {
  const day = spokenDay(pending.dueDate, options.today);
  const report = pending.note ? `Got it: "${pending.note}" ` : "Got it. ";
  const move = pending.followUpId && pending.previousDueAt
    ? `I'll move ${theAccount(pending.accountName)} follow-up to ${day} and put it on that day's line.`
    : pending.pipelineId
      ? `I'll schedule a follow-up with ${pending.accountName} for ${day} and put it on that day's line.`
      : `${pending.accountName} doesn't have a pipeline record, so I'll put the follow-up on ${day}'s line.`;
  return `${report}${move} I'll keep what they told you as hearsay. Say yes to save it.`;
}

function uuidFrom(hex: string): string {
  const h = hex.padEnd(32, "0").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type AccountFollowUpCommit = {
  pipelineSaved: boolean;
  dayLineSaved: boolean;
  dayLineCommitmentId: string | null;
  errors: string[];
};

export async function commitAccountFollowUp(
  pending: PendingAccountFollowUp,
  input: { tenantId: string; operatorUserId: string; dayDirectorActorId: string; timeZone: string },
  deps: {
    reschedule?: typeof rescheduleCommercialFollowUp;
    schedule?: typeof scheduleCommercialFollowUp;
    accept?: typeof acceptProposal;
  } = {}
): Promise<AccountFollowUpCommit> {
  const reschedule = deps.reschedule ?? rescheduleCommercialFollowUp;
  const schedule = deps.schedule ?? scheduleCommercialFollowUp;
  const accept = deps.accept ?? acceptProposal;
  const dueAt = fromZonedTime(`${pending.dueDate}T10:00:00`, input.timeZone);
  const result: AccountFollowUpCommit = {
    pipelineSaved: false,
    dayLineSaved: false,
    dayLineCommitmentId: null,
    errors: [],
  };
  if (pending.pipelineId) {
    try {
      if (pending.followUpId) {
        await reschedule({
          tenantId: input.tenantId,
          pipelineId: pending.pipelineId,
          followUpId: pending.followUpId,
          actorId: input.operatorUserId,
          requestId: uuidFrom(pending.requestId),
          dueAt,
        });
      } else {
        await schedule({
          tenantId: input.tenantId,
          pipelineId: pending.pipelineId,
          actorId: input.operatorUserId,
          requestId: uuidFrom(pending.requestId),
          dueAt,
          note: `Operator report (hearsay kept as hearsay): ${pending.note}`.slice(0, 1000),
        });
      }
      result.pipelineSaved = true;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    const stored = await accept({
      tenantId: input.tenantId,
      actorId: input.dayDirectorActorId,
      businessDate: pending.dueDate,
      proposal: {
        promptKey: `account-follow-up:${pending.requestId}`,
        title: `Follow up with ${pending.accountName}`.slice(0, 255),
        kind: "growth",
        quantity: null,
        sourceText: pending.note || `Follow up with ${pending.accountName}`,
        prerequisites: [],
        question: null,
        intelligence: "anthropic",
        detailState: "COMPLETE",
        missingDetails: [],
        detailNote: pending.note ? `Operator report, hearsay kept as hearsay: ${pending.note}` : null,
      },
    });
    const storedId =
      stored && typeof stored === "object" && "id" in stored
        ? String((stored as { id?: unknown }).id ?? "")
        : "";
    result.dayLineCommitmentId = storedId || null;
    result.dayLineSaved = Boolean(storedId);
    if (!storedId) result.errors.push("Day Line follow-up write returned no commitment id");
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

export function speakAccountFollowUpCommit(pending: PendingAccountFollowUp, commit: AccountFollowUpCommit, today: string): string {
  const day = spokenDay(pending.dueDate, today);
  const subject = theAccount(pending.accountName);
  if (commit.pipelineSaved && commit.dayLineSaved) return `Saved. ${subject.charAt(0).toUpperCase()}${subject.slice(1)} follow-up is on ${day}.`;
  if (commit.dayLineSaved) {
    return pending.pipelineId
      ? `I put ${subject} follow-up on ${day}'s line, but I couldn't move it in the sales pipeline.`
      : `Saved on ${day}'s line.`;
  }
  if (commit.pipelineSaved) return `I moved ${subject} follow-up to ${day} in the pipeline, but I couldn't add it to the Day Line.`;
  return "I understood it, but I couldn't save it. Nothing changed.";
}
