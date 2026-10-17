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
  commitmentIds: string[];
  receipts: MutationReceipt[];
};

export async function commitBriefing(
  parsed: ParsedBriefing,
  input: { tenantId: string; dayDirectorActorId: string; conversationKey: string; vehicleId?: string },
  deps: {
    accept?: (input: Parameters<typeof acceptProposalWithReceipt>[0]) => Promise<Awaited<ReturnType<typeof acceptProposalWithReceipt>> | Awaited<ReturnType<typeof acceptProposal>>>;
    complete?: typeof completeDayDirectorCommitment;
    update?: typeof updateDayDirectorCommitment;
    linkVehicleWork?: typeof confirmLinkedVehicleWork;
    readCanonical?: typeof readDayDirectorCanonicalCommitment;
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

  const result: BriefingCommitResult = { added: [], completed: [], alreadyPresent: [], warnings: [], failed: [], commitmentIds: [], receipts: [] };
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
  for (const item of parsed.items) {
    try {
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
          transcript: item.quote, place: item.place, confirmed: true });
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
        } });
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
    const existingWord = result.alreadyPresent?.length ? `${result.alreadyPresent.length} already on the line` : null;
    const doneWord = result.completed.length ? `${result.completed.length} marked done` : null;
    const parts = [...dayParts, ...(existingWord ? [existingWord] : []), ...(doneWord ? [doneWord] : [])];
    sentences.push(parts.length ? `Done. ${joinList(parts).replace(/^./, c => c.toUpperCase())}.` : "Nothing new needed saving.");
  } else {
    const saved = result.added.length + result.completed.length;
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
    ...result.added.map(item => ({ item, verb: "Added" })),
    ...result.completed.map(item => ({ item, verb: "Marked done" })),
    ...(result.alreadyPresent ?? []).map(item => ({ item, verb: "Already saved" })),
  ];
  if (named.length) {
    const details = named.map(({ item, verb }) =>
      `${verb} ${item.title}${item.executionType ? ` as a ${item.executionType.replace(/_/g, " ")}` : ""} for ${spokenDay(item.businessDate, today)}.`
    );
    if (!result.failed.length) {
      if (result.added.length === 0 && result.completed.length === 0) {
        sentences[0] = details.join(" ");
      } else {
        sentences.push(details.join(" "));
      }
    } else {
      sentences.unshift(details.join(" "));
    }
  }
  return sentences.join(" ");
}

