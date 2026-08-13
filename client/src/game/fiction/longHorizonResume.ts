/**
 * Long-horizon resume (Slice 101) — Goldline surviving a return later that
 * day, tomorrow, or next month with no daily reset and no stale fiction.
 *
 * This does not build a new resume mechanism. `useAuthoritativeActionResume`
 * (client/src/game/actions/useAuthoritativeActionResume.ts) already detects
 * "the player came back from an external handoff" and re-triggers a fetch —
 * that hook is the WHEN. This module is the WHAT-TO-DO-WITH-IT: once
 * authoritative reality has been re-read (Today's Route reprojected from
 * fresh server data), `reconcileFictionOnResume` drops every persisted
 * fiction assignment whose real action no longer exists among the live
 * missions. The Fiction Director never resurrects a finished story —
 * reality wins, structurally, because a pruned assignment simply isn't
 * there for `selectFictionForMission` to find on the next visit.
 */
import { deriveActionGrammar } from "../../../../shared/actionGrammar";
import { stableMissionKey } from "../../../../shared/fictionTemplate";
import { resolveGoldlineAction, type GoldlineActionContext } from "../actions/actionRegistry";
import {
  fictionAssignmentCount,
  pruneResolvedFictionAssignments,
} from "./fictionAssignmentStorage";
import type { FictionAssignmentIdentity } from "./fictionAssignmentStorage";
import type { PlayableMission } from "../state/GameState";

/**
 * Stable keys for every mission that is genuinely live right now, given
 * freshly re-read authoritative state. Missions with no resolvable action
 * (captured/closed/read-only) contribute no key — exactly matching what the
 * Fiction Director itself would decline to instantiate for.
 */
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

/**
 * Reconciles persisted fiction assignments against freshly re-read reality.
 * Call this once per resume, AFTER the authoritative refetch has completed
 * (i.e. inside `useAuthoritativeActionResume`'s `onResume` callback, once
 * fresh missions are available) — never before, or it would prune against
 * stale data and could drop a genuinely still-live mission's assignment.
 */
export function reconcileFictionOnResume(input: {
  liveMissions: PlayableMission[];
  now: Date;
  identity?: FictionAssignmentIdentity;
  fictionRulesVersion?: number;
}): { prunedCount: number } {
  const identity = input.identity ?? null;
  const before = fictionAssignmentCount(identity);
  const keys = liveMissionFictionKeys(
    input.liveMissions,
    input.now,
    input.fictionRulesVersion ?? 1
  );
  const remaining = pruneResolvedFictionAssignments(keys, identity);
  return { prunedCount: Math.max(0, before - remaining.length) };
}
