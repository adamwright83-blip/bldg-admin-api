/**
 * Corridor-to-corridor travel, as a game moment rather than a page load.
 *
 * Two responsibilities, both of which exist to protect the player's sense of
 * standing in one continuous world:
 *
 *   1. PHASES. The current corridor stays rendered the entire time the next
 *      one is loading. The phase sequence drives a diegetic cue (the route
 *      signalling a destination) instead of a spinner, and the caller is
 *      expected to keep the old world on screen until `revealing`.
 *
 *   2. STALE-LOAD REJECTION. Corridor loads are async and racy: a slow load
 *      for corridor_A must never overwrite a corridor_B the player asked for
 *      afterwards. Every request takes a monotonically increasing sequence
 *      number, the previous in-flight load is aborted, and a late result is
 *      dropped as `superseded` — it can never be applied.
 *
 * This module owns no Pixi objects and no React state. It decides *whether*
 * a corridor may be applied; the caller performs the swap.
 */
import type { ResolvedCorridorPack } from "../world/corridorPack";
import { reportGoldlineLifecycleDelta } from "../testSupport/lifecycleProbe";

/**
 * `signaling` — destination became real; the world cues it (route pulse,
 *               mission context). Old corridor still fully visible.
 * `loading`   — next pack is being fetched. Old corridor STILL visible; this
 *               phase must never blank the canvas.
 * `revealing` — next pack validated; camera/world hand off to it.
 * `ready`     — player has control in the new corridor.
 */
export const CORRIDOR_TRANSITION_PHASES = [
  "idle",
  "signaling",
  "loading",
  "revealing",
  "ready",
] as const;

export type CorridorTransitionPhase =
  (typeof CORRIDOR_TRANSITION_PHASES)[number];

export type CorridorTransitionOutcome =
  /** Pack loaded and is the newest request — caller should swap to it. */
  | { outcome: "applied"; pack: ResolvedCorridorPack; requestId: number }
  /** A newer corridor was requested while this one loaded. Do not apply. */
  | { outcome: "superseded"; corridorId: string; requestId: number }
  /** Caller explicitly cancelled (route leave, unmount). Do not apply. */
  | { outcome: "aborted"; corridorId: string; requestId: number }
  /** Load failed. The CURRENT corridor is untouched and still playable. */
  | { outcome: "failed"; corridorId: string; requestId: number; error: Error }
  /** Already standing in this corridor; nothing to do. */
  | { outcome: "already_active"; corridorId: string; requestId: number };

export type CorridorLoader = (
  corridorId: string,
  signal: AbortSignal
) => Promise<ResolvedCorridorPack>;

export type CorridorRevealer = (
  pack: ResolvedCorridorPack,
  signal: AbortSignal
) => void | Promise<void>;

export type CorridorTransitionEvents = {
  onPhaseChange?: (
    phase: CorridorTransitionPhase,
    corridorId: string | null
  ) => void;
};

/**
 * Serializes corridor requests so exactly one corridor can ever win.
 *
 * Not a queue: a newer request does not wait behind an older one, it
 * *replaces* it. The player's most recent intent is always the one that
 * resolves.
 */
export class CorridorTransitionController {
  private requestSeq = 0;
  private activeCorridorId: string | null = null;
  private phase: CorridorTransitionPhase = "idle";
  private inflight: { requestId: number; abort: AbortController } | null = null;
  private disposed = false;
  private probeActive = false;

  constructor(private readonly events: CorridorTransitionEvents = {}) {
    if (events.onPhaseChange) {
      this.probeActive = true;
      reportGoldlineLifecycleDelta("corridorTransitionCallback", 1);
    }
  }

  getPhase(): CorridorTransitionPhase {
    return this.phase;
  }

  getActiveCorridorId(): string | null {
    return this.activeCorridorId;
  }

  /** The newest request id handed out — a late load compares itself to this. */
  /**
   * Aborts any load currently in flight, leaving the corridor the player is
   * standing in exactly as it is.
   *
   * Used when an expedition takes ownership of the world: a transition
   * requested moments earlier must not resolve and swap the corridor out
   * from under active combat. Returns true if something was actually
   * cancelled, so callers can log or assert on it.
   */
  cancelInflight(): boolean {
    if (!this.inflight) return false;
    this.inflight.abort.abort();
    this.inflight = null;
    this.setPhase(this.activeCorridorId ? "ready" : "idle", this.activeCorridorId);
    return true;
  }

  hasInflight(): boolean {
    return this.inflight !== null;
  }

  getLatestRequestId(): number {
    return this.requestSeq;
  }

  private setPhase(phase: CorridorTransitionPhase, corridorId: string | null) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.events.onPhaseChange?.(phase, corridorId);
  }

  /**
   * Marks a corridor as the one currently being stood in without loading it —
   * used once at boot, when the initial corridor was started by the existing
   * mount path rather than by a transition.
   */
  adoptActiveCorridor(corridorId: string) {
    this.activeCorridorId = corridorId;
    this.setPhase("ready", corridorId);
  }

  /**
   * Requests travel to `corridorId`.
   *
   * The returned outcome tells the caller whether it is allowed to swap. Any
   * outcome other than `applied` means the existing corridor must be left
   * exactly as it is.
   */
  async requestCorridor(
    corridorId: string,
    loader: CorridorLoader,
    reveal?: CorridorRevealer
  ): Promise<CorridorTransitionOutcome> {
    const requestId = ++this.requestSeq;

    if (this.disposed) {
      return { outcome: "aborted", corridorId, requestId };
    }

    if (this.activeCorridorId === corridorId && this.phase === "ready") {
      return { outcome: "already_active", corridorId, requestId };
    }

    // A newer intent invalidates the older one immediately — the old load is
    // aborted rather than left to finish and be discarded.
    this.inflight?.abort.abort();

    const abort = new AbortController();
    this.inflight = { requestId, abort };

    // The world does not blank here; these phases are cues layered over the
    // corridor the player is still standing in.
    this.setPhase("signaling", corridorId);
    this.setPhase("loading", corridorId);

    let pack: ResolvedCorridorPack;
    try {
      pack = await loader(corridorId, abort.signal);
    } catch (error) {
      const isAbort =
        (error instanceof DOMException && error.name === "AbortError") ||
        abort.signal.aborted;

      if (this.inflight?.requestId === requestId) this.inflight = null;

      // Superseded/aborted loads leave the phase alone: a newer request is
      // already driving it, and the current corridor stayed playable
      // throughout.
      if (requestId !== this.requestSeq) {
        return { outcome: "superseded", corridorId, requestId };
      }
      if (isAbort) {
        this.setPhase(
          this.activeCorridorId ? "ready" : "idle",
          this.activeCorridorId
        );
        return { outcome: "aborted", corridorId, requestId };
      }

      // Failure returns the player to the corridor they never left.
      this.setPhase(
        this.activeCorridorId ? "ready" : "idle",
        this.activeCorridorId
      );
      return {
        outcome: "failed",
        corridorId,
        requestId,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }

    if (this.inflight?.requestId === requestId) this.inflight = null;

    // The decisive check: this load only counts if no newer corridor was
    // requested while it was in flight.
    if (requestId !== this.requestSeq || this.disposed) {
      return { outcome: "superseded", corridorId, requestId };
    }

    this.setPhase("revealing", corridorId);
    try {
      await reveal?.(pack, abort.signal);
    } catch (error) {
      this.setPhase(
        this.activeCorridorId ? "ready" : "idle",
        this.activeCorridorId
      );

      // A reveal that was deliberately refused is NOT a failure. The
      // expedition guard aborts the reveal when it takes ownership of the
      // world, and reporting that as "failed" surfaced a false
      // "ROUTE HELD - DESTINATION UNAVAILABLE" to a player who had simply
      // started an expedition. The corridor is intact either way; only the
      // truthfulness of the feedback differs.
      const isAbort =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError") ||
        abort.signal.aborted;
      if (isAbort) {
        return { outcome: "aborted", corridorId, requestId };
      }

      return {
        outcome: "failed",
        corridorId,
        requestId,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
    if (requestId !== this.requestSeq || this.disposed) {
      return { outcome: "superseded", corridorId, requestId };
    }
    this.activeCorridorId = corridorId;
    this.setPhase("ready", corridorId);

    return { outcome: "applied", pack, requestId };
  }

  /**
   * Cancels any in-flight load. Idempotent, and safe to call from a React
   * cleanup — a load that lands afterwards can no longer be applied because
   * `disposed` fails the same guard a stale request does.
   */
  dispose() {
    this.disposed = true;
    this.inflight?.abort.abort();
    this.inflight = null;
    if (this.probeActive) {
      this.probeActive = false;
      reportGoldlineLifecycleDelta("corridorTransitionCallback", -1);
    }
    this.setPhase("idle", null);
  }
}
