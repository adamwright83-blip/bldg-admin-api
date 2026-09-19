import { createHash } from "node:crypto";
import {
  acceptProposal,
  completeDayDirectorCommitment,
  getDayDirectorState,
  updateDayDirectorCommitment,
} from "../../dayDirector/dayDirectorService";
import type { ClaireCampaignSummary } from "../campaignAwareness";
import { joinList, plural } from "../business/businessSpeech";
import type { MutationReceipt } from "../assertionGuard";
import { spokenDay } from "./briefingTiming";
import type { BriefingItem, ParsedBriefing } from "./briefingTypes";
import { enforceTitleContract } from "./titleContract";

/**
 * Turning a confirmed briefing into Day Line truth, without duplicates:
 * work already on the line is recognized, campaign work is not re-added,
 * completed work completes its existing item (or is logged as done), and
 * every write is idempotent per conversation so a retried webhook cannot
 * create a second copy. The result reports exactly what saved.
 */

export type ExistingWork = { id: string; title: string; businessDate: string; status: "open" | "completed" };

export async function loadExistingWork(
  input: { tenantId: string; dayDirectorActorId: string; dates: string[] },
  deps: { getState?: typeof getDayDirectorState } = {}
): Promise<ExistingWork[]> {
  const getState = deps.getState ?? getDayDirectorState;
  const dates = Array.from(new Set(input.dates));
  const states = await Promise.all(
    dates.map(businessDate =>
      getState({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, businessDate }).catch(() => null)
    )
  );
  return states.flatMap((state, index) =>
    (state?.commitments ?? []).map(commitment => ({
      id: commitment.id,
      title: commitment.title,
      businessDate: dates[index]!,
      status: commitment.status === "completed" ? ("completed" as const) : ("open" as const),
    }))
  );
}

const GENERIC = new Set([
  "the", "a", "an", "to", "for", "from", "at", "on", "of", "and", "up", "off", "my", "his", "her", "their", "pickup", "pick",
  "deliver", "delivery", "drop", "get", "go", "drive", "make", "order", "orders", "today", "tomorrow", "with", "back", "some",
  "already", "delivered", "picked", "dropped", "finished", "done",
]);

function distinctive(title: string): string[] {
  return Array.from(
    new Set(
      title
        .toLowerCase()
        .replace(/'s\b/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(token => token.length >= 3 && !GENERIC.has(token))
    )
  );
}

export function matchExistingWork(item: BriefingItem, existing: ExistingWork[]): ExistingWork | null {
  const wanted = distinctive(item.title);
  if (!wanted.length) return null;
  let best: { work: ExistingWork; score: number } | null = null;
  for (const work of existing) {
    if (work.businessDate !== item.businessDate) continue;
    const have = distinctive(work.title);
    const shared = wanted.filter(token => have.includes(token)).length;
    // One shared word ("OPUS") is not the same task; two distinct shared words, or identical one-word subjects, are.
    const needed = wanted.length === 1 && have.length === 1 ? 1 : 2;
    if (shared >= needed && shared > 0 && (!best || shared > best.score)) best = { work, score: shared };
  }
  return best?.work ?? null;
}

const CAMPAIGN_WORDS = /\b(gr[ae]y ?star|colosseum|coliseum)\b/i;

export function reconcileBriefing(
  parsed: ParsedBriefing,
  existing: ExistingWork[],
  campaign: ClaireCampaignSummary | null
): ParsedBriefing {
  const items = parsed.items.map(item => {
    if (item.kind === "new_work" && campaign?.active && CAMPAIGN_WORDS.test(item.quote)) {
      return { ...item, existing: { id: "campaign", title: item.title, source: "campaign" as const } };
    }
    const match = matchExistingWork(item, existing);
    if (!match) return item;
    if (item.kind === "new_work" && match.status === "open") {
      return { ...item, existing: { id: match.id, title: match.title, source: "day_line" as const } };
    }
    if (item.kind === "completed" && match.status === "open") {
      return { ...item, existing: { id: match.id, title: match.title, source: "day_line" as const } };
    }
    if (item.kind === "completed" && match.status === "completed") {
      return { ...item, existing: { id: match.id, title: match.title, source: "day_line" as const } };
    }
    return item;
  });
  return { ...parsed, items };
}

function keyFor(conversationKey: string, item: BriefingItem): string {
  return createHash("sha256")
    .update(`${conversationKey}|${item.kind}|${item.businessDate}|${item.quote.toLowerCase().replace(/\s+/g, " ")}`)
    .digest("hex")
    .slice(0, 40);
}

function detailNote(item: BriefingItem): string | null {
  const parts = [
    item.timing.kind === "none" ? null : item.timing.label,
    item.people.length ? `for ${item.people.join(" & ")}` : null,
    item.place ? `at ${item.place}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ") : null;
}

export type BriefingCommitResult = {
  added: BriefingItem[];
  completed: BriefingItem[];
  failed: Array<{ item: BriefingItem; error: string }>;
  commitmentIds: string[];
  receipts: MutationReceipt[];
};

export async function commitBriefing(
  parsed: ParsedBriefing,
  input: { tenantId: string; dayDirectorActorId: string; conversationKey: string },
  deps: {
    accept?: typeof acceptProposal;
    complete?: typeof completeDayDirectorCommitment;
    update?: typeof updateDayDirectorCommitment;
  } = {}
): Promise<BriefingCommitResult> {
  const accept = deps.accept ?? acceptProposal;
  const complete = deps.complete ?? completeDayDirectorCommitment;
  const update = deps.update ?? updateDayDirectorCommitment;
  const result: BriefingCommitResult = { added: [], completed: [], failed: [], commitmentIds: [], receipts: [] };
  for (const item of parsed.items) {
    try {
      if (item.kind === "new_work") {
        if (item.existing) continue;
        const stored = await accept({
          tenantId: input.tenantId,
          actorId: input.dayDirectorActorId,
          businessDate: item.businessDate,
          proposal: {
            promptKey: `briefing:${keyFor(input.conversationKey, item)}`,
            title: enforceTitleContract(item.title).slice(0, 255),
            kind: "operations",
            quantity: item.quantity,
            sourceText: item.quote,
            prerequisites: [],
            question: null,
            intelligence: parsed.source === "model" ? "anthropic" : "manual_fallback",
            detailState: item.needs ? "NEEDS_DETAILS" : "COMPLETE",
            missingDetails: item.needs ? [item.needs] : [],
            detailNote: detailNote(item),
          },
        });
        const id = stored && typeof stored === "object" && "id" in stored ? String((stored as { id?: unknown }).id ?? "") : "";
        if (!id) throw new Error("Day Line item was not persisted");
        if (item.timing.kind !== "none") {
          await update({
            tenantId: input.tenantId,
            actorId: input.dayDirectorActorId,
            commitmentId: id,
            patch: {
              scheduleKind: item.timing.kind === "at" ? "EXACT_TIME" : item.timing.kind === "daypart" ? "DAY" : "FLEXIBLE_WINDOW",
              scheduleLabel: item.timing.label,
            },
          }).catch(() => undefined);
        }
        result.added.push(item);
        result.commitmentIds.push(id);
        result.receipts.push({ claimedState: "created", entityId: id, statement: `Added ${item.title} to the Day Line` });
        continue;
      }
      // Completed work: complete the existing Day Line item, or log Adam's report as done.
      if (item.existing?.source === "day_line") {
        await complete({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, commitmentId: item.existing.id });
        result.completed.push(item);
        result.commitmentIds.push(item.existing.id);
        result.receipts.push({ claimedState: "completed", entityId: item.existing.id, statement: `Marked ${item.title} done` });
        continue;
      }
      const stored = await accept({
        tenantId: input.tenantId,
        actorId: input.dayDirectorActorId,
        businessDate: item.businessDate,
        proposal: {
          promptKey: `briefing-done:${keyFor(input.conversationKey, item)}`,
          title: enforceTitleContract(item.title).slice(0, 255),
          kind: "operations",
          quantity: null,
          sourceText: item.quote,
          prerequisites: [],
          question: null,
          intelligence: parsed.source === "model" ? "anthropic" : "manual_fallback",
          detailState: "COMPLETE",
          missingDetails: [],
          detailNote: "Operator reported this as already done",
        },
      });
      const id = stored && typeof stored === "object" && "id" in stored ? String((stored as { id?: unknown }).id ?? "") : "";
      if (!id) throw new Error("Completed report was not persisted");
      await complete({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, commitmentId: id });
      result.completed.push(item);
      result.commitmentIds.push(id);
      result.receipts.push({ claimedState: "completed", entityId: id, statement: `Marked ${item.title} done` });
    } catch (error) {
      result.failed.push({ item, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** Truthful readback: only what actually saved is spoken as saved. */
export function speakBriefingCommit(result: BriefingCommitResult, today: string): string {
  const sentences: string[] = [];
  const byDay = new Map<string, number>();
  for (const item of result.added) byDay.set(item.businessDate, (byDay.get(item.businessDate) ?? 0) + 1);
  const dayParts = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => {
      const label = spokenDay(day, today);
      return `${count} on ${label === "today" ? "today's" : label === "tomorrow" ? "tomorrow's" : `${label}'s`} line`;
    });
  if (!result.failed.length) {
    const doneWord = result.completed.length ? `${result.completed.length} marked done` : null;
    const parts = [...dayParts, ...(doneWord ? [doneWord] : [])];
    sentences.push(parts.length ? `Done. ${joinList(parts).replace(/^./, c => c.toUpperCase())}.` : "Nothing new needed saving.");
  } else {
    const saved = result.added.length + result.completed.length;
    sentences.push(
      saved
        ? `I saved ${saved} ${plural(saved, "item")}, but ${result.failed.length} didn't save: ${joinList(result.failed.map(failure => failure.item.title))}.`
        : `I understood it, but nothing saved: ${joinList(result.failed.map(failure => failure.item.title))}.`
    );
    sentences.push("Want me to try those again?");
  }
  return sentences.join(" ");
}
