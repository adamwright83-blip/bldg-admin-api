/**
 * LOCAL_TARGET_RUN — a real-world "visit N businesses" objective (§PR77
 * Part 8-20).
 *
 * The old behaviour split "visit 10 dry cleaners" into ten generic prose
 * board steps. This is the recognized shape instead: ONE parent objective,
 * carrying the operator's real intent (action/targetQuery/requestedCount/
 * purpose/anchor) plus the real, provider-sourced businesses that satisfy
 * it — never invented, never padded.
 *
 * Persisted as JSON inside a single `open_channel_mission_tasks.detail`
 * column (unbounded TEXT) rather than a new table: `detail` already exists,
 * is per-task, and needs no migration. `decodeLocalTargetRunPayload` is the
 * one place that distinguishes a target-run task's detail from an ordinary
 * task's free-text detail — a normal task's prose will never happen to
 * parse as JSON with `kind: "local_target_run"`.
 */

export const LOCAL_TARGET_RUN_ACTIONS = ["visit"] as const;
export type LocalTargetRunAction = (typeof LOCAL_TARGET_RUN_ACTIONS)[number];

/**
 * A single real, provider-sourced business — or, when Places is
 * unavailable, one of exactly ten clearly-labeled synthetic placeholders
 * (Adam's explicit road-testing fallback). `simulated` is what every
 * consumer (UI badge, truth gates, Field Intel linkage) keys off of; a
 * simulated target must never be mistaken for a real one downstream.
 */
export type SourcedTarget = {
  /** Stable, provider-backed: `places:<placeId>` or `simulated:<n>`. */
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  website: string | null;
  phone: string | null;
  navigationUrl: string;
  simulated: boolean;
};

export type LocalTargetRunSourcingStatus =
  /** Sourcing has not run yet (should not persist long — draft generation
   * sources synchronously). */
  | "pending"
  /** Real or simulated targets are populated. Check `simulated` for which. */
  | "sourced";

export type LocalTargetRunPayload = {
  kind: "local_target_run";
  action: LocalTargetRunAction;
  /** What the operator asked for, e.g. "dry cleaner". Never invented. */
  targetQuery: string;
  requestedCount: number;
  purpose: string;
  geographicAnchorLabel: string | null;
  sourcingStatus: LocalTargetRunSourcingStatus;
  /** True when ANY target in this run came from the labeled-simulation
   * fallback (Places unavailable). A run is never a silent mix — see
   * localTargetRunSourcing.ts, sourcing is all-real or all-simulated. */
  simulated: boolean;
  /** Real sourced count vs. what was asked for — truthful even when
   * `requestedCount` could not be fully met (Part 16, never padded). */
  sourcedTargets: SourcedTarget[];
  /** Authoritative: populated only from confirmed Field Intel at that
   * target, never from mere navigation or arrival (Part 20 gate J). */
  visitedTargetIds: string[];
};

export function isSourcedTargetKind(value: string): value is "sourced_target" {
  return value === "sourced_target";
}

export function encodeLocalTargetRunPayload(payload: LocalTargetRunPayload): string {
  return JSON.stringify(payload);
}

/** Returns null for anything that isn't a target-run payload — including
 * every ordinary task's free-text detail, and any malformed JSON. */
export function decodeLocalTargetRunPayload(detail: string): LocalTargetRunPayload | null {
  if (!detail || detail.charAt(0) !== "{") return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { kind?: unknown }).kind === "local_target_run"
    ) {
      return parsed as LocalTargetRunPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function currentLocalTargetRunTarget(
  payload: LocalTargetRunPayload
): SourcedTarget | null {
  return (
    payload.sourcedTargets.find(target => !payload.visitedTargetIds.includes(target.id)) ??
    null
  );
}

export function localTargetRunVisitedCount(payload: LocalTargetRunPayload): number {
  const sourcedIds = new Set(payload.sourcedTargets.map(target => target.id));
  return payload.visitedTargetIds.filter(id => sourcedIds.has(id)).length;
}

export function localTargetRunIsComplete(payload: LocalTargetRunPayload): boolean {
  return (
    payload.sourcedTargets.length > 0 &&
    localTargetRunVisitedCount(payload) >= payload.sourcedTargets.length
  );
}

/** "TARGET 3 OF 10" — 1-based for display. Null once every sourced target
 * has been visited (nothing left to point at). */
export function localTargetRunProgressLabel(payload: LocalTargetRunPayload): string | null {
  const visited = localTargetRunVisitedCount(payload);
  if (payload.sourcedTargets.length === 0) return null;
  if (visited >= payload.sourcedTargets.length) return null;
  return `TARGET ${visited + 1} OF ${payload.sourcedTargets.length}`;
}

/** The ten hardcoded, deliberately-fake, un-routable placeholders used only
 * when Places sourcing is unavailable (Adam's explicit road-testing rail —
 * simulated so the mission wrapper stays testable, fake enough that
 * NAVIGATE opening Maps-but-failing-to-route is itself the "Places is the
 * broken part" signal). Exported so the sourcing adapter, gates, and any
 * UI that needs to recognize "is this the known simulation set" share one
 * definition. */
export const SIMULATED_DRY_CLEANER_TARGETS: ReadonlyArray<{
  name: string;
  address: string;
}> = [
  { name: "Daffney's Cleaners", address: "1 Candy Pop Lane" },
  { name: "Second Sash Press & Fold", address: "12 Marzipan Court" },
  { name: "Button & Crease Cleaners", address: "23 Lollipop Row" },
  { name: "The Tidy Thread", address: "34 Gumdrop Avenue" },
  { name: "Pressed for Time Cleaners", address: "45 Peppermint Way" },
  { name: "Crisp Collar Co.", address: "56 Butterscotch Lane" },
  { name: "Neatly Done Cleaners", address: "67 Jellybean Terrace" },
  { name: "Starch & Steam", address: "78 Licorice Court" },
  { name: "The Fold Room", address: "89 Toffee Circle" },
  { name: "Cleanline Cleaners", address: "90 Candyfloss Road" },
];

export function simulatedLocalTargetRunTargets(): SourcedTarget[] {
  return SIMULATED_DRY_CLEANER_TARGETS.map((entry, index) => {
    const fullAddress = `${entry.address}, Nowhere, ZZ 00000`;
    return {
      id: `simulated:${index + 1}`,
      name: entry.name,
      address: fullAddress,
      lat: null,
      lng: null,
      website: null,
      phone: null,
      navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`,
      simulated: true,
    };
  });
}
