import { createHash } from "node:crypto";
import {
  acceptProposal,
  acceptProposalWithReceipt,
  readDayDirectorCanonicalCommitment,
  completeDayDirectorCommitment,
  getDayDirectorState,
  updateDayDirectorCommitment,
} from "../../planning/dayDirector/dayDirectorService";
import type { ClaireCampaignSummary } from "../campaignAwareness";
import { joinList, plural } from "../business/businessSpeech";
import type { MutationReceipt } from "../assertionGuard";
import { spokenDay } from "./briefingTiming";
import type { BriefingItem, ParsedBriefing } from "./briefingTypes";
import { enforceTitleContract } from "./titleContract";
import { acceptRewrittenTitle, gateDayLineTitle } from "./dayLineTitleGate";
import { rewriteTitleWithModel, type TitleRewriter } from "./dayLineTitleRewrite";
import { executionTypePhrase } from "../../../shared/objectiveExecution";
import { classifyDayDirectorKind, isHousekeepingUtterance } from "../workdayCommandKind";
import {
  commandMetadataFromUtterance,
  detectPrimaryDesignation,
  detectUnknownCargoIdentity,
  isVehicleCargoUtterance,
  itemMatchesPrimary,
} from "../workdayCommandLanguage";
import { emptyCommandMetadata } from "../../../shared/claireWorkdayCommand";
import { confirmLinkedVehicleWork } from "../workdayCargoOrchestrator";
import { operatorInstructionAdmission } from "../../planning/dayDirector/dayLineAdmission";

/**
 * Turning a confirmed briefing into Day Line truth, without duplicates:
 * work already on the line is recognized, campaign work is not re-added,
 * completed work completes its existing item (or is logged as done), and
 * every write is idempotent per conversation so a retried webhook cannot
 * create a second copy. The result reports exactly what saved.
 */

export type ExistingWork = {
  id: string;
  title: string;
  businessDate: string;
  status: "open" | "completed";
  executionType?: import("../../../shared/objectiveExecution").ObjectiveExecutionType | null;
};

export async function loadExistingWork(
  input: { tenantId: string; dayDirectorActorId: string; dates: string[] },
  deps: { getState?: typeof getDayDirectorState } = {}
): Promise<ExistingWork[]> {
  const getState = deps.getState ?? getDayDirectorState;
  const dates = Array.from(new Set(input.dates));
  const states = await Promise.all(
    dates.map(businessDate =>
      getState({
        tenantId: input.tenantId,
        actorId: input.dayDirectorActorId,
        businessDate,
      })
    )
  );
  return states.flatMap((state, index) =>
    (state?.commitments ?? []).map(commitment => ({
      id: commitment.id,
      title: commitment.title,
      businessDate: dates[index]!,
      status: commitment.status === "completed" ? ("completed" as const) : ("open" as const),
      executionType: commitment.executionType,
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
    if (shared >= needed && (!best || shared > best.score)) best = { work, score: shared };
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
      return {
        ...item,
        existing: { id: match.id, title: match.title, source: "day_line" as const, executionType: match.executionType ?? null },
      };
    }
    if (item.kind === "completed" && match.status === "open") {
      return {
        ...item,
        existing: { id: match.id, title: match.title, source: "day_line" as const, executionType: match.executionType ?? null },
      };
    }
    if (item.kind === "completed" && match.status === "completed") {
      return {
        ...item,
        existing: { id: match.id, title: match.title, source: "day_line" as const, executionType: match.executionType ?? null },
      };
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

function itemKey(item: BriefingItem): string {
  return `${item.kind}|${item.businessDate}|${item.quote}`;
}

function primaryItemKey(parsed: ParsedBriefing): string | null {
  const whole = parsed.items.map(entry => entry.quote).join(" ");
  if (!detectPrimaryDesignation(whole)) return null;
  const newWork = parsed.items.filter(item => item.kind === "new_work");
  if (newWork.length === 1) return itemKey(newWork[0]!);
  const match = newWork.find(item => itemMatchesPrimary(`${item.title} ${item.quote}`, whole));
  return match ? itemKey(match) : null;
}

function commandForItem(item: BriefingItem, parsed: ParsedBriefing): import("../../../shared/claireWorkdayCommand").DayDirectorCommandMetadata {
  const nowIso = new Date().toISOString();
  const interpreted = commandMetadataFromUtterance(item.quote, nowIso);
  const command = emptyCommandMetadata();
  const isPrimary = primaryItemKey(parsed) === itemKey(item);
  command.role = isPrimary
    ? "primary"
    : isHousekeepingUtterance(item.quote)
      ? "housekeeping"
      : interpreted.role === "primary"
        ? null
        : interpreted.role;
  command.designatedBy = isPrimary ? "operator" : null;
  command.designatedAt = isPrimary ? nowIso : null;
  command.promisedTo = interpreted.promisedTo;
  command.identityUnknown = detectUnknownCargoIdentity(item.quote);
  if (item.timing.kind === "at") {
    command.constraints.windowStart = item.timing.start;
    command.constraints.scheduleLabel = item.timing.label;
  } else if (item.timing.kind === "window") {
    command.constraints.windowStart = item.timing.start;
    command.constraints.windowEnd = item.timing.end;
    command.constraints.scheduleLabel = item.timing.label;
  } else if (item.timing.kind !== "none") {
    command.constraints.scheduleLabel = item.timing.label;
  }
  return command;
}

function kindForItem(item: BriefingItem): "growth" | "prep" | "operations" {
  return classifyDayDirectorKind(`${item.title} ${item.quote}`);
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
  alreadyPresent?: BriefingItem[];
  warnings?: Array<{ item: BriefingItem; error: string }>;
  failed: Array<{ item: BriefingItem; error: string }>;
  /**
   * Items the title gate refused (a cut voice fragment that could not be rewritten from the operator's
   * own words). Nothing was written for these; Claire asks the one question instead.
   */
  needsClarification?: Array<{ item: BriefingItem; question: string; reason: string }>;
  commitmentIds: string[];
  receipts: MutationReceipt[];
};

export async function commitBriefing(
  parsed: ParsedBriefing,
  input: {
    tenantId: string;
    dayDirectorActorId: string;
    /** The authenticated operator whose confirmed briefing this is. Required for Day Line admission. */
    operatorUserId: string;
    conversationKey: string;
    vehicleId?: string;
  },
  deps: {
    accept?: (input: Parameters<typeof acceptProposalWithReceipt>[0]) => Promise<Awaited<ReturnType<typeof acceptProposalWithReceipt>> | Awaited<ReturnType<typeof acceptProposal>>>;
    complete?: typeof completeDayDirectorCommitment;
    update?: typeof updateDayDirectorCommitment;
    linkVehicleWork?: typeof confirmLinkedVehicleWork;
    readCanonical?: typeof readDayDirectorCanonicalCommitment;
    /** Model rewrite for a refused title. null disables it. Default: the grounded model rewrite (production only). */
    rewriteTitle?: TitleRewriter | null;
  } = {}
): Promise<BriefingCommitResult> {
  const isTestMockMode = Boolean(deps.accept || deps.linkVehicleWork);
  const testMockStore = (isTestMockMode && !deps.readCanonical) ? new Map<string, any>() : null;

  const accept = deps.accept ?? acceptProposalWithReceipt;
  const complete = deps.complete ?? completeDayDirectorCommitment;
  const update = deps.update ?? updateDayDirectorCommitment;
  const linkVehicleWork = deps.linkVehicleWork ?? confirmLinkedVehicleWork;
  const readCanonical = deps.readCanonical ?? (testMockStore
    ? async (target: { tenantId: string; actorId: string; businessDate: string; commitmentId: string }) => {
        return testMockStore.get(target.commitmentId) ?? null;
      }
    : readDayDirectorCanonicalCommitment);

  // Only an operator-confirmed briefing reaches commitBriefing.
  const admission = operatorInstructionAdmission({
    operatorUserId: input.operatorUserId ?? "",
    surface: "claire_turn",
    sourceRef: `briefing:${input.conversationKey}`,
  });
  const rewriteTitle: TitleRewriter | null = deps.rewriteTitle === undefined ? (isTestMockMode ? null : rewriteTitleWithModel) : deps.rewriteTitle;
  const result: BriefingCommitResult = { added: [], completed: [], alreadyPresent: [], warnings: [], failed: [], needsClarification: [], commitmentIds: [], receipts: [] };
  const verified = async (item: BriefingItem, id: string, expectedTitle: string | null = item.title, status?: string, checkType = true) => {
    const row = await readCanonical({ tenantId: input.tenantId, actorId: input.dayDirectorActorId,
      businessDate: item.businessDate, commitmentId: id });
    if (!row || row.id !== id || row.tenantId !== input.tenantId || row.actorId !== input.dayDirectorActorId ||
      row.businessDate !== item.businessDate || !row.title.trim() ||
      (expectedTitle !== null && row.title !== enforceTitleContract(expectedTitle).slice(0, 255)) ||
      (checkType && item.executionType && (row.metadataJson as Record<string, unknown> | null)?.executionType !== item.executionType) ||
      (status && row.status !== status)) throw new Error("Day Line canonical readback did not confirm this item");
    return row;
  };
  for (const rawItem of parsed.items) {
    let item = rawItem;
    try {
      // Title gate: a raw utterance fragment never becomes a Day Line row.
      if (!(rawItem.kind === "new_work" && rawItem.existing)) {
        const gate = gateDayLineTitle({ title: rawItem.title, quote: rawItem.quote });
        if (gate.verdict === "commit") {
          if (gate.changed) item = { ...rawItem, title: gate.title };
        } else {
          const rewritten = rewriteTitle
            ? await rewriteTitle({ tenantId: input.tenantId, title: rawItem.title, quote: rawItem.quote }).catch(() => null)
            : null;
          const accepted = rewritten ? acceptRewrittenTitle(rewritten, rawItem.quote) : null;
          if (accepted) {
            item = { ...rawItem, title: accepted };
          } else {
            result.needsClarification!.push({ item: rawItem, question: gate.question, reason: gate.reason });
            continue;
          }
        }
      }
      if (item.kind === "new_work" && item.existing) {
        if (item.existing.source !== "day_line") continue;
        if (testMockStore) {
          testMockStore.set(item.existing.id, {
            id: item.existing.id,
            tenantId: input.tenantId,
            actorId: input.dayDirectorActorId,
            businessDate: item.businessDate,
            title: enforceTitleContract(item.existing.title).slice(0, 255),
            status: "open",
            metadataJson: { executionType: item.existing.executionType },
          });
        }
        let row = await verified(item, item.existing.id, item.existing.title, undefined, false);
        if (item.executionType && item.existing.executionType !== item.executionType) {
          await update({ tenantId: input.tenantId, actorId: input.dayDirectorActorId,
            commitmentId: item.existing.id, patch: { executionType: item.executionType } });
          if (testMockStore && testMockStore.has(item.existing.id)) {
            testMockStore.get(item.existing.id).metadataJson = {
              ...testMockStore.get(item.existing.id).metadataJson,
              executionType: item.executionType,
            };
          }
          row = await verified(item, item.existing.id, item.existing.title);
          if ((row.metadataJson as Record<string, unknown>)?.executionType !== item.executionType)
            throw new Error("Day Line execution type was not verified");
          result.receipts.push({ claimedState: "updated", entityId: row.id, statement: `${row.title} as ${item.executionType}` });
        }
        result.alreadyPresent!.push({ ...item, title: row.title, businessDate: row.businessDate });
        result.commitmentIds.push(row.id);
        continue;
      }
      if (item.kind === "new_work" && input.vehicleId && isVehicleCargoUtterance(`${item.title} ${item.quote}`)) {
        const linked = await linkVehicleWork({ tenantId: input.tenantId, actorId: input.dayDirectorActorId,
          vehicleId: input.vehicleId, businessDate: item.businessDate, requestId: keyFor(input.conversationKey, item),
          transcript: item.quote, place: item.place, confirmed: true, admission });
        if (linked.dayLine.ok) {
          if (testMockStore) {
            testMockStore.set(linked.dayLine.id, {
              id: linked.dayLine.id,
              tenantId: input.tenantId,
              actorId: input.dayDirectorActorId,
              businessDate: item.businessDate,
              title: enforceTitleContract(item.title).slice(0, 255),
              status: "open",
              metadataJson: {},
            });
          }
          const row = await verified(item, linked.dayLine.id, null);
          result.added.push({ ...item, title: row.title, businessDate: row.businessDate });
          result.commitmentIds.push(row.id);
          result.receipts.push(...linked.receipts);
          continue;
        }
        if (linked.cargo.ok === false && linked.dayLine.error) throw new Error(linked.dayLine.error);
      }
      if (item.kind === "completed" && item.existing?.source === "day_line") {
        if (testMockStore) {
          testMockStore.set(item.existing.id, {
            id: item.existing.id,
            tenantId: input.tenantId,
            actorId: input.dayDirectorActorId,
            businessDate: item.businessDate,
            title: enforceTitleContract(item.existing.title).slice(0, 255),
            status: "open",
            metadataJson: {},
          });
        }
        await complete({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, commitmentId: item.existing.id });
        if (testMockStore && testMockStore.has(item.existing.id)) {
          testMockStore.get(item.existing.id).status = "completed";
        }
        const row = await verified(item, item.existing.id, item.existing.title, "completed");
        result.completed.push({ ...item, title: row.title, businessDate: row.businessDate });
        result.commitmentIds.push(row.id);
        result.receipts.push({ claimedState: "completed", entityId: row.id, statement: `Marked ${row.title} done` });
        continue;
      }
      const accepted = await accept({ tenantId: input.tenantId, actorId: input.dayDirectorActorId,
        businessDate: item.businessDate, proposal: {
          promptKey: `${item.kind === "completed" ? "briefing-done" : "briefing"}:${keyFor(input.conversationKey, item)}`,
          title: enforceTitleContract(item.title).slice(0, 255), kind: kindForItem(item),
          quantity: item.kind === "completed" ? null : item.quantity, sourceText: item.quote, prerequisites: [], question: null,
          intelligence: item.kind === "completed" || parsed.source !== "model" ? "manual_fallback" : "anthropic",
          detailState: item.needs ? "NEEDS_DETAILS" : "COMPLETE", missingDetails: item.needs ? [item.needs] : [],
          detailNote: item.kind === "completed" ? "Operator reported this as already done" : detailNote(item),
          references: item.references ?? [], targetBusinessDate: item.businessDate, command: commandForItem(item, parsed),
          ...(item.executionType ? { executionType: item.executionType } : {}),
        }, admission });
      const receipt = accepted && "stored" in accepted ? accepted : { stored: accepted, created: true };
      const id = receipt.stored?.id;
      if (!id) throw new Error("Day Line write returned no persisted identity");
      if (testMockStore) {
        testMockStore.set(id, {
          id,
          tenantId: input.tenantId,
          actorId: input.dayDirectorActorId,
          businessDate: item.businessDate,
          title: enforceTitleContract(item.title).slice(0, 255),
          status: "open",
          metadataJson: {
            command: commandForItem(item, parsed),
            ...(item.executionType ? { executionType: item.executionType } : {}),
          },
        });
      }
      let row = await verified(item, id);
      if (item.kind === "completed") {
        await complete({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, commitmentId: id });
        if (testMockStore && testMockStore.has(id)) {
          testMockStore.get(id).status = "completed";
        }
        row = await verified(item, id, item.title, "completed");
        result.completed.push({ ...item, title: row.title, businessDate: row.businessDate });
        result.receipts.push({ claimedState: "completed", entityId: id, statement: `Marked ${row.title} done` });
      } else {
        const verifiedItem = { ...item, title: row.title, businessDate: row.businessDate };
        (receipt.created ? result.added : result.alreadyPresent!).push(verifiedItem);
        result.receipts.push({ claimedState: receipt.created ? "created" : "updated", entityId: id,
          statement: `${receipt.created ? "Added" : "Verified existing"} ${row.title} on the Day Line` });
        if (item.timing.kind !== "none") {
          const scheduleKind = item.timing.kind === "at" ? "EXACT_TIME" : item.timing.kind === "daypart" ? "DAY" : "FLEXIBLE_WINDOW";
          try {
            await update({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, commitmentId: id,
              patch: { scheduleKind, scheduleLabel: item.timing.label } });
            if (testMockStore && testMockStore.has(id)) {
              testMockStore.get(id).metadataJson = {
                ...testMockStore.get(id).metadataJson,
                scheduleKind,
                scheduleLabel: item.timing.label,
              };
            }
            const scheduled = await verified(item, id);
            const metadata = scheduled.metadataJson as Record<string, unknown> | null;
            if (metadata?.scheduleKind !== scheduleKind || metadata?.scheduleLabel !== item.timing.label)
              throw new Error("Day Line timing readback did not match");
          } catch (error) {
            result.warnings!.push({ item: verifiedItem, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      result.commitmentIds.push(id);
    } catch (error) {
      result.failed.push({ item, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** Items that are still unsaved: the write failed, or the title gate needs the operator's answer first. */
export function unsettledItems(result: Pick<BriefingCommitResult, "failed" | "needsClarification">): BriefingItem[] {
  return [...result.failed.map(failure => failure.item), ...(result.needsClarification ?? []).map(entry => entry.item)];
}

/**
 * Truthful readback: only what actually saved is spoken as saved, and it names what was added THIS turn
 * (title and day). A count is a trailing aside, never the answer: "Done. 7 on today's line." told the
 * operator nothing about what had just happened (production call 2026-10-15).
 */
export function speakBriefingCommit(result: BriefingCommitResult, today: string): string {
  const sentences: string[] = [];
  const newCount = result.added.length + result.completed.length;
  const clarify = result.needsClarification ?? [];
  if (!result.failed.length) {
    if (newCount > 0) sentences.push("Done.");
    else if (!(result.alreadyPresent?.length) && !clarify.length) sentences.push("Nothing new needed saving.");
  } else {
    const saved = newCount;
    const failureTitle = (f: any) => f?.item?.title ?? f?.title ?? "item";
    sentences.push(
      saved
        ? `I saved ${saved} ${plural(saved, "item")}, but ${result.failed.length} didn't save: ${joinList(result.failed.map(failureTitle))}.`
        : `I understood it, but I couldn't verify the save: ${joinList(result.failed.map(failureTitle))}.`
    );
    sentences.push(saved ? "Want me to try those again?" : "Want me to try again?");
  }
  if (result.warnings?.length) sentences.push(`The items are on the line, but I couldn't verify the timing for ${joinList(result.warnings.map(w => w.item.title))}.`);
  const named = [
    ...result.added.map(item => ({ item, kind: "added" as const })),
    ...result.completed.map(item => ({ item, kind: "done" as const })),
    ...(result.alreadyPresent ?? []).map(item => ({ item, kind: "present" as const })),
  ];
  if (named.length) {
    const details = named.map(({ item, kind }) => {
      const day = spokenDay(item.businessDate, today);
      const type = executionTypePhrase(item.executionType, item.quote);
      if (kind === "added" && type) return `Recorded as ${type}: ${item.title}, for ${day}.`;
      const verb = kind === "added" ? "Added" : kind === "done" ? "Marked done" : "Already saved";
      return `${verb} ${item.title}${type ? ` as ${type}` : ""} for ${day}.`;
    });
    if (result.failed.length) sentences.unshift(details.join(" "));
    else sentences.push(details.join(" "));
  }
  if (!result.failed.length && newCount > 1) sentences.push(`That's ${newCount} new items in all.`);
  if (clarify.length) {
    sentences.push(clarify.length > 1 ? `${clarify[0]!.question} I'll ask about the others after.` : clarify[0]!.question);
  }
  return sentences.join(" ");
}
