/**
 * Long-horizon resume (Slice 101) — Goldline surviving a return later that
 * day, tomorrow, or next month with no daily reset and no stale fiction.
 *
 * Mission-backed and route-backed actions come from different authoritative
 * projections. A mission-only reconciliation must not delete a route-backed
 * fiction assignment just because field-move truth is not present in its
 * `PlayableMission[]` input.
 */
import { deriveActionGrammar } from "../../../../shared/actionGrammar";
import { stableMissionKey } from "../../../../shared/fictionTemplate";
import { resolveGoldlineAction, type GoldlineActionContext } from "../actions/actionRegistry";
import {
  fictionAssignmentCount,
  fictionAssignmentKeysForGrammarKind,
  pruneResolvedFictionAssignments,
} from "./fictionAssignmentStorage";
import type { FictionAssignmentIdentity } from "./fictionAssignmentStorage";
import type { PlayableMission } from "../state/GameState";

export function liveMissionFictionKeys(
  missions: PlayableMission[],
  now: Date,
  fictionRulesVersion = 1
): string[] {
  const keys: string[] = [];
  for (const mission of missions) {
    const context: GoldlineActionContext = {
      mission,
      now,
      followUp: null,
      scoutCapability: null,
      scoutReport: null,
    };
    const descriptor = resolveGoldlineAction(context);
    if (!descriptor) continue;
    const grammar = deriveActionGrammar(descriptor);
    if (!grammar) continue;
    keys.push(
      stableMissionKey({
        businessActionId: grammar.businessActionId,
        occurrenceId: grammar.occurrenceId,
        grammarKind: grammar.kind,
        fictionRulesVersion,
      })
    );
  }
  return keys;
}

export function reconcileFictionOnResume(input: {
  liveMissions: PlayableMission[];
  now: Date;
  identity?: FictionAssignmentIdentity;
  fictionRulesVersion?: number;
}): { prunedCount: number } {
  const identity = input.identity ?? null;
  const before = fictionAssignmentCount(identity);
  const missionKeys = liveMissionFictionKeys(
    input.liveMissions,
    input.now,
    input.fictionRulesVersion ?? 1
  );
  const routeKeys = fictionAssignmentKeysForGrammarKind(
    "PLACE_ITEM_AT_LOCATIONS",
    identity
  );
  const remaining = pruneResolvedFictionAssignments(
    [...missionKeys, ...routeKeys],
    identity
  );
  return { prunedCount: Math.max(0, before - remaining.length) };
}
