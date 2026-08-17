/**
 * Contextual teaching state for expedition mechanics (§PR77 Part 4).
 *
 * Same identity-scoping pattern as `checkpointStorage.ts`: the storage key
 * includes the authenticated identity, so a shared phone cannot inherit a
 * previous player's learned-state flags and an unauthenticated session gets
 * its own `anon` bucket. This is deliberately a SEPARATE module from the
 * general `onboardingProgress.ts` milestones (movement/jump/climb/etc.) —
 * that module is device-scoped by design, and folding expedition combat
 * teaching into it would either regress its existing device-scoped
 * behaviour or silently change its semantics for unrelated callers.
 *
 * Each mechanic is in exactly one of three states:
 *
 *   UNLEARNED -> TEACHING -> LEARNED
 *
 * A mechanic only ever advances to LEARNED because the caller reports the
 * player genuinely performed it (a strike that landed, an evade that
 * began, a Line that fired and locked, a relic taken, a route chosen) —
 * never because a hint was merely displayed. There is no way to mark a
 * mechanic learned from this module without that explicit call, which is
 * what keeps "teaching" from silently retiring on its own.
 */

export const EXPEDITION_MECHANICS = ["strike", "evade", "line", "relic", "fork"] as const;

export type ExpeditionMechanic = (typeof EXPEDITION_MECHANICS)[number];

export type MechanicLearningState = "unlearned" | "teaching" | "learned";

/** `null` means "not signed in" and maps to its own bucket — deliberately
 * not shared with any real account. */
export type ExpeditionTeachingIdentity = string | null;

const STORAGE_PREFIX = "goldline:expedition-teaching:v1";

export function expeditionTeachingStorageKey(identity: ExpeditionTeachingIdentity): string {
  return `${STORAGE_PREFIX}:${identity && identity.length ? identity : "anon"}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLearned(identity: ExpeditionTeachingIdentity): Set<ExpeditionMechanic> {
  const store = storage();
  if (!store) return new Set();
  try {
    const raw = store.getItem(expeditionTeachingStorageKey(identity));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is ExpeditionMechanic =>
        (EXPEDITION_MECHANICS as readonly string[]).includes(value)
      )
    );
  } catch {
    return new Set();
  }
}

export function isMechanicLearned(
  mechanic: ExpeditionMechanic,
  identity: ExpeditionTeachingIdentity = null
): boolean {
  return readLearned(identity).has(mechanic);
}

/** Idempotent — marking an already-learned mechanic is a no-op. */
export function markMechanicLearned(
  mechanic: ExpeditionMechanic,
  identity: ExpeditionTeachingIdentity = null
): void {
  const store = storage();
  if (!store) return;
  try {
    const learned = readLearned(identity);
    if (learned.has(mechanic)) return;
    learned.add(mechanic);
    store.setItem(
      expeditionTeachingStorageKey(identity),
      JSON.stringify(Array.from(learned))
    );
  } catch {
    // Best-effort only — a lost teaching flag just means the hint reappears.
  }
}

/**
 * `relevantNow` is the caller's own judgement that this mechanic is worth
 * surfacing right now (e.g. it is next in teaching priority order). This
 * function only ever decides LEARNED vs. everything else — it never
 * invents a learned state, and it never demotes a learned mechanic back to
 * teaching just because the caller still thinks it is relevant.
 */
export function mechanicLearningState(
  mechanic: ExpeditionMechanic,
  relevantNow: boolean,
  identity: ExpeditionTeachingIdentity = null
): MechanicLearningState {
  if (isMechanicLearned(mechanic, identity)) return "learned";
  return relevantNow ? "teaching" : "unlearned";
}

/**
 * The first mechanic in canonical teaching order that is not yet learned,
 * or null once every mechanic has been learned. The authored expedition
 * encounter order (`expeditionPlan.ts`) already introduces hostiles, the
 * first Line target, the first relic, and the fork one at a time, so
 * "next unlearned mechanic" tracks what the player is actually about to
 * encounter without this module needing its own copy of corridor
 * proximity.
 */
export function nextUnlearnedMechanic(
  identity: ExpeditionTeachingIdentity = null
): ExpeditionMechanic | null {
  const learned = readLearned(identity);
  for (const mechanic of EXPEDITION_MECHANICS) {
    if (!learned.has(mechanic)) return mechanic;
  }
  return null;
}

/** Test/QA hook: resets one identity's (or the anon bucket's) teaching
 * state. Tests must be able to reset learning state (§PR77 Part 4). */
export function resetExpeditionTeaching(
  identity: ExpeditionTeachingIdentity = null
): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(expeditionTeachingStorageKey(identity));
  } catch {
    // Best-effort only.
  }
}

/** Removes every identity's expedition-teaching state on this device. */
export function resetAllExpeditionTeaching(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && key.startsWith(`${STORAGE_PREFIX}:`)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Best-effort only.
  }
}
