/**
 * Durable write primitives. Callers must already hold the outcome map.
 * This file does not read Day 1 missions. Day 1 must not call these
 * functions: a satisfied hunt is not level.colosseum. Reads do not live
 * here. Kingdom completion is not written here.
 */
import {
  assertCompanionRookRecordPermitted,
  assertLevelColosseumRecordPermitted,
  ProgressionNotPermittedError,
  rejectClientProgressionForge,
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
  authoredConsequence?: unknown;
  clientPayload?: unknown;
}): Promise<void> {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  const existing = await findDomainProgression(input);
  if (!existing.readable) unreadable();
  assertCompanionRookRecordPermitted({
    outcomes: input.outcomes,
    outcomesAvailable: input.outcomesAvailable,
    levelColosseumResolvedAt: existing.row?.levelColosseumResolvedAt ?? null,
    authoredConsequence: input.authoredConsequence,
    clientPayload: input.clientPayload,
  });
  if (existing.row?.companionRookOwnedAt) return;
  await setCompanionRookOwnedAt({ ...input, ownedAt: new Date() });
  const written = await findDomainProgression(input);
  if (!written.readable) unreadable();
  if (!written.row?.companionRookOwnedAt) {
    throw new ProgressionNotPermittedError("companion.rook was not recorded for this operator");
  }
}
