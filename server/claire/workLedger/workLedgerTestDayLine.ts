/**
 * In-memory Day Line with the same read/write surface the work ledger uses in
 * production. Test support only: it lets the ledger run end to end (plan →
 * write → readback → speech) against real model output without a database.
 */
import { randomUUID } from "node:crypto";
import type { BriefingCommitResult } from "../briefing/briefingCommit";
import type { WorkLedgerApplyDeps } from "./workLedgerApply";
import type { WorkLedgerTurnDeps } from "./workLedgerTurn";

export type FakeDayLineRow = {
  id: string;
  businessDate: string;
  title: string;
  sourceText: string;
  status: "open" | "completed";
  executionType: "mission" | "challenge" | "hybrid_objective" | null;
  detailNote: string | null;
  scheduleLabel: string | null;
  cancelled: boolean;
};

export function createFakeDayLine(seed: Array<Partial<FakeDayLineRow> & { title: string; businessDate: string }> = []) {
  const rows = new Map<string, FakeDayLineRow>();
  for (const entry of seed) {
    const id = entry.id ?? randomUUID();
    rows.set(id, {
      id,
      businessDate: entry.businessDate,
      title: entry.title,
      sourceText: entry.sourceText ?? entry.title,
      status: entry.status ?? "open",
      executionType: entry.executionType ?? null,
      detailNote: entry.detailNote ?? null,
      scheduleLabel: entry.scheduleLabel ?? null,
      cancelled: entry.cancelled ?? false,
    });
  }
  const writes: string[] = [];

  const readState: WorkLedgerTurnDeps["readState"] = (async (input: { businessDate: string }) => ({
    processingLocation: null,
    dismissedPromptKeys: [],
    intelligenceAvailable: true,
    commitments: Array.from(rows.values())
      .filter(row => row.businessDate === input.businessDate && !row.cancelled)
      .map(row => ({
        id: row.id,
        businessDate: row.businessDate,
        title: row.title,
        status: row.status,
        sourceText: row.sourceText,
        detailNote: row.detailNote,
        scheduleLabel: row.scheduleLabel,
        executionType: row.executionType,
      })),
  })) as unknown as WorkLedgerTurnDeps["readState"];

  const commit: WorkLedgerApplyDeps["commit"] = async parsed => {
    const result: BriefingCommitResult = { added: [], completed: [], alreadyPresent: [], warnings: [], failed: [], commitmentIds: [], receipts: [] };
    for (const item of parsed.items) {
      const id = randomUUID();
      rows.set(id, {
        id,
        businessDate: item.businessDate,
        title: item.title,
        sourceText: item.quote,
        status: "open",
        executionType: item.executionType ?? null,
        detailNote: item.timing.kind === "none" ? null : item.timing.label,
        scheduleLabel: item.timing.kind === "none" ? null : item.timing.label,
        cancelled: false,
      });
      writes.push(`create ${item.businessDate} ${item.title}`);
      result.added.push(item);
      result.commitmentIds.push(id);
      result.receipts.push({ claimedState: "created", entityId: id, statement: `Added ${item.title} on the Day Line` });
    }
    return result;
  };

  const update: WorkLedgerApplyDeps["update"] = async input => {
    const row = rows.get(input.commitmentId);
    if (!row) throw new Error("Day Director commitment not found");
    if ("executionType" in input.patch) row.executionType = input.patch.executionType ?? null;
    if (input.patch.detailNote !== undefined) row.detailNote = input.patch.detailNote;
    if (input.patch.scheduleLabel !== undefined) row.scheduleLabel = input.patch.scheduleLabel ?? null;
    writes.push(`update ${row.title} ${JSON.stringify(input.patch)}`);
    return { ok: true as const, id: row.id };
  };

  const complete: WorkLedgerApplyDeps["complete"] = async input => {
    const row = rows.get(input.commitmentId);
    if (!row) throw new Error("Day Director commitment not found");
    row.status = "completed";
    writes.push(`complete ${row.title}`);
    return { ok: true as const, alreadyCompleted: false };
  };

  const edit: WorkLedgerApplyDeps["edit"] = async input => {
    const row = rows.get(input.item.sourceId);
    if (!row) throw new Error("Day Director commitment not found");
    const previousTitle = row.title;
    row.title = input.actionTitle;
    writes.push(`retitle ${previousTitle} -> ${input.actionTitle}`);
    return {
      ok: true as const,
      sourceType: input.item.sourceType,
      sourceId: row.id,
      previousTitle,
      displayTitle: row.title,
      accountName: previousTitle,
    };
  };

  const cancel: WorkLedgerApplyDeps["cancel"] = async input => {
    const row = rows.get(input.item.sourceId);
    if (!row) throw new Error("Day Director commitment not found");
    row.cancelled = true;
    writes.push(`remove ${row.title}`);
    return {
      ok: true as const,
      sourceType: input.item.sourceType,
      sourceId: row.id,
      reasonStored: Boolean(input.reason),
      accountName: row.title,
      displayTitle: row.title,
    };
  };

  const move: WorkLedgerApplyDeps["move"] = async input => {
    const row = rows.get(input.commitmentId);
    if (!row || row.cancelled || row.status !== "open" || row.businessDate !== input.fromBusinessDate) return false;
    row.businessDate = input.toBusinessDate;
    writes.push(`move ${row.title} to ${input.toBusinessDate}`);
    return true;
  };

  return {
    rows,
    writes,
    open: () => Array.from(rows.values()).filter(row => !row.cancelled),
    deps: {
      readState,
      apply: { commit, update, complete, edit, cancel, move, readState: readState as unknown as WorkLedgerApplyDeps["readState"] },
    },
  };
}
