import type { CorridorBranch } from "../state/GameState";

/**
 * Persists the player's position in the corridor, not their business
 * state — authoritative business state (mission list, world nodes) is
 * always reconciled fresh from the backend on resume, never restored from
 * this. Only ever written from a safe avatar state (see GoldlineGame's
 * reportCheckpointIfSafe) so a restore can never resume mid-jump/vault/
 * climb/encounter. Same localStorage pattern as onboardingProgress.ts.
 */
export type Checkpoint = {
  corridorId: string;
  progress: number;
  lateral: number;
  branch: CorridorBranch;
  savedAt: string;
};

const STORAGE_KEY = "goldline:checkpoint:v1";

export function saveCheckpoint(checkpoint: Checkpoint): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoint));
  } catch {
    // Best-effort only — losing a checkpoint just means starting the
    // corridor from its default entry point, never a broken state.
  }
}

/** Returns null if there's no checkpoint, it's corrupted, or it's for a different corridor. */
export function loadCheckpoint(corridorId: string): Checkpoint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Checkpoint>;
    if (
      parsed.corridorId !== corridorId ||
      typeof parsed.progress !== "number" ||
      typeof parsed.lateral !== "number" ||
      typeof parsed.branch !== "string"
    ) {
      return null;
    }
    return parsed as Checkpoint;
  } catch {
    return null;
  }
}

export function clearCheckpoint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only.
  }
}
