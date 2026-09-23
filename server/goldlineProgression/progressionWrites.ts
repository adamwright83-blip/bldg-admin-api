/**
 * Durable writes. Callers must already hold the outcome map. This file does
 * not read Day 1 missions, so the outcome writer can call it without a cycle.
 * Reads do not live here. Kingdom completion is not written here.
 */
import {
  assertCompanionRookRecordPermitted,
  assertLevelColosseumRecordPermitted,
} from "./progressionContract";
import {
  findDomainProgression,
  insertLevelColosseumResolved,
  setCompanionRookOwnedAt,
  setLevelColosseumResolvedAt,
} from "./progressionStore";

function unreadable(): never {
  const missing = new Error("goldline_domain_progression is not readable");
  missing.name = "ProgressionSchemaBlockedError";
  throw missing;
}

export async function recordLevelFromOutcomes(input: {
  tenantId: string;
  operatorId: string;
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  clientPayload?: unknown;
}): Promise<void> {
  assertLevelColosseumRecordPermitted(input);
  const existing = await findDomainProgression(input);
  if (!existing.readable) unreadable();
  if (existing.row?.levelColosseumResolvedAt) return;
  const resolvedAt = new Date();
  if (!existing.row) {
    await insertLevelColosseumResolved({ ...input, resolvedAt });
    const raced = await findDomainProgression(input);
    if (raced.readable && raced.row && !raced.row.levelColosseumResolvedAt) {
      await setLevelColosseumResolvedAt({ ...input, resolvedAt });
    }
    return;
  }
  await setLevelColosseumResolvedAt({ ...input, resolvedAt });
}

export async function recordRookFromOutcomes(input: {
  tenantId: string;
  operatorId: string;
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  clientPayload?: unknown;
}): Promise<void> {
  const existing = await findDomainProgression(input);
  if (!existing.readable) unreadable();
  assertCompanionRookRecordPermitted({
    ...input,
    levelColosseumResolvedAt: existing.row?.levelColosseumResolvedAt ?? null,
  });
  if (existing.row?.companionRookOwnedAt) return;
  await setCompanionRookOwnedAt({ ...input, ownedAt: new Date() });
}
