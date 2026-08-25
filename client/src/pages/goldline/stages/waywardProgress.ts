export type WaywardProgress = {
  unlocked: boolean;
  visited: boolean;
  guardianCleared: boolean;
  spanCrossed: boolean;
  cacheCollected: boolean;
  tetherAwake: boolean;
  relic: "tether-memory" | null;
};

export const EMPTY_WAYWARD_PROGRESS: WaywardProgress = {
  unlocked: false,
  visited: false,
  guardianCleared: false,
  spanCrossed: false,
  cacheCollected: false,
  tetherAwake: false,
  relic: null,
};

export function waywardProgressKey(identity: string | null) {
  return `goldline:fantasy:wayward:v1:${identity?.length ? identity : "anon"}`;
}

export function colosseumResolutionKey(identity: string | null) {
  return `goldline:fantasy:colosseum-resolved:v1:${identity?.length ? identity : "anon"}`;
}

export function markColosseumResolved(identity: string | null) {
  try { storage()?.setItem(colosseumResolutionKey(identity), "1"); } catch { /* best-effort fantasy continuity */ }
}

export function hasColosseumResolved(identity: string | null): boolean {
  try { return storage()?.getItem(colosseumResolutionKey(identity)) === "1"; } catch { return false; }
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function hasLegacyDay1Dismissal(): boolean {
  try { return storage()?.getItem("goldline:day1:dismissed") === "1"; } catch { return false; }
}

export function markLegacyDay1Dismissal() {
  try { storage()?.setItem("goldline:day1:dismissed", "1"); } catch { /* migration hint only */ }
}

export function shouldAutoEnterWayward(input: {
  colosseumResolved: boolean;
  campaignComplete: boolean;
  testHarness: boolean;
}) {
  return input.colosseumResolved && input.campaignComplete && !input.testHarness;
}

export function loadWaywardProgress(identity: string | null): WaywardProgress {
  try {
    const raw = storage()?.getItem(waywardProgressKey(identity));
    if (!raw) return { ...EMPTY_WAYWARD_PROGRESS };
    const value = JSON.parse(raw) as Partial<WaywardProgress>;
    return {
      unlocked: value.unlocked === true,
      visited: value.visited === true,
      guardianCleared: value.guardianCleared === true,
      spanCrossed: value.spanCrossed === true,
      cacheCollected: value.cacheCollected === true,
      tetherAwake: value.tetherAwake === true,
      relic: value.relic === "tether-memory" ? "tether-memory" : null,
    };
  } catch { return { ...EMPTY_WAYWARD_PROGRESS }; }
}

export function saveWaywardProgress(identity: string | null, value: WaywardProgress) {
  try { storage()?.setItem(waywardProgressKey(identity), JSON.stringify(value)); } catch { /* fantasy continuity is best-effort */ }
}

export function unlockWayward(identity: string | null): WaywardProgress {
  const next = { ...loadWaywardProgress(identity), unlocked: true };
  saveWaywardProgress(identity, next);
  return next;
}
