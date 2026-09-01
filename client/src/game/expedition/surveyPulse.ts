/**
 * SURVEY — active information gathering, and the fourth primary verb.
 *
 * `actionPad.ts` is explicit that expedition play has exactly two touch
 * zones and no third button. SURVEY honours that. It is not a button: it is
 * the gesture of *standing still and looking*, expressed on the movement
 * stick that is already under the player's left thumb.
 *
 *   press the stick and keep the thumb near centre for SETTLE_MS
 *     -> SURVEY pulse fires
 *   deflect the thumb past SURVEY_DEADZONE at any point before that
 *     -> the settle is abandoned and the press is ordinary movement
 *
 * That mapping is deliberate on three counts:
 *
 *   1. It cannot collide with movement. Movement is *deflection*; a stick
 *      held at centre currently produces input (0,0) and does nothing at
 *      all, so the gesture consumes an input that was previously dead.
 *   2. It cannot collide with STRIKE / EVADE / LINEHOOK, which all live on
 *      the right pad and are resolved by `ActionPad`.
 *   3. The gesture *is* the cost. See below.
 *
 * THE TRADEOFF (§Slice 3)
 *
 * SURVEY is not free, and it deliberately does not spend a currency — there
 * is no scan meter and no charges. What it costs is the thing the player
 * actually values in a corridor: motion. Settling takes real time with the
 * stick centred, which means the player is stationary and not dodging while
 * hostiles keep closing. Information is bought with position. Moving early
 * refunds nothing and reveals nothing; the settle simply does not complete.
 *
 * The cooldown exists for the same reason a scan meter does not: it stops
 * SURVEY becoming a thing you hold down permanently, without inventing a
 * resource to track.
 *
 * TIME BASE
 *
 * Settle progress is measured in REAL elapsed milliseconds, exactly as
 * `ActionPad` measures its hold threshold, so the gesture feels identical
 * whether or not fictional time is dilated. The cooldown, by contrast, is
 * stepped in simulation seconds alongside the dodge cooldown, because it is
 * a gameplay resource rather than an input gesture.
 *
 * FIREWALL
 *
 * SURVEY reveals *fictional world state* — hostile posture, hazard arcs,
 * latch anchors, traversal openings. `SurveyReveal` carries an opaque game
 * id and a position and nothing else: there is no field on it capable of
 * holding a customer, a building, an order, or any other business identity,
 * so no caller can use a scan result to assert that a real place was
 * visited or that a real opportunity exists. Surveying is looking at the
 * fiction, and looking is never evidence.
 */

/** Real ms the thumb must rest near centre before the pulse fires. */
export const SETTLE_MS = 260;

/**
 * Normalised stick deflection above which the press is movement, not a
 * settle. Comfortably above the resting jitter of a thumb that intends to
 * stay put, and comfortably below the 0.15 at which `Joystick` reports a
 * first real move.
 */
export const SURVEY_DEADZONE = 0.12;

/** Simulation seconds before SURVEY may fire again. */
export const SURVEY_COOLDOWN_SECONDS = 6;

/** How far a pulse reaches, in corridor units. */
export const SURVEY_RADIUS = 520;

/** Simulation seconds a revealed subject stays lit. */
export const SURVEY_REVEAL_SECONDS = 4.5;

/**
 * Most subjects a single pulse will surface. A pulse that lights up the
 * whole corridor is a map screen, not a decision.
 */
export const SURVEY_MAX_REVEALS = 6;

export type SurveyPhase = "idle" | "settling" | "spent";

/**
 * What a pulse can reveal. Every member is a fictional feature of the
 * corridor. Nothing here names a real-world entity, by construction.
 */
export const SURVEY_SUBJECT_KINDS = [
  /** A hostile, and which way it is currently facing/winding up. */
  "hostile",
  /** A hazard's swept arc, shown before it fires. */
  "hazard",
  /** A latchable anchor the player had not spotted. */
  "anchor",
  /** A traversal opening — a shortcut through the corridor. */
  "opening",
] as const;
export type SurveySubjectKind = (typeof SURVEY_SUBJECT_KINDS)[number];

/**
 * A candidate the corridor offers to the pulse.
 *
 * `id` is an opaque *game* handle (a hostile's runtime id, an anchor's id).
 * It is never a customer id, order id, or physical-entity id, and there is
 * deliberately no field on this type in which such an id could travel.
 */
export type SurveyCandidate = {
  readonly id: string;
  readonly kind: SurveySubjectKind;
  readonly x: number;
  readonly y: number;
  /**
   * Set when the subject is already plainly visible to the player. Survey
   * is for finding what you could not already see, so these are skipped —
   * otherwise the pulse's best use would be spamming it at things already
   * on screen.
   */
  readonly alreadyVisible?: boolean;
};

export type SurveyReveal = {
  readonly id: string;
  readonly kind: SurveySubjectKind;
  readonly x: number;
  readonly y: number;
  /** Distance from the pulse origin, in corridor units. */
  readonly distance: number;
  /** Simulation seconds this reveal has left before it fades. */
  remaining: number;
};

/**
 * Chooses what a pulse at (`originX`, `originY`) surfaces.
 *
 * Pure and deterministic: nearest-first, already-visible subjects dropped,
 * out-of-range subjects dropped, capped at `SURVEY_MAX_REVEALS`. Ties break
 * on id so two identical corridors reveal identically.
 */
export function resolveSurveyReveals(
  candidates: readonly SurveyCandidate[],
  originX: number,
  originY: number,
  radius: number = SURVEY_RADIUS
): SurveyReveal[] {
  return candidates
    .filter(candidate => !candidate.alreadyVisible)
    .map(candidate => ({
      id: candidate.id,
      kind: candidate.kind,
      x: candidate.x,
      y: candidate.y,
      distance: Math.hypot(candidate.x - originX, candidate.y - originY),
      remaining: SURVEY_REVEAL_SECONDS,
    }))
    .filter(reveal => reveal.distance <= radius)
    .sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1))
    .slice(0, SURVEY_MAX_REVEALS);
}

export type SurveyObserver = {
  /** The settle began to build — callers may show a gathering ring. */
  onSettleBegin?: () => void;
  /** The settle was abandoned (moved, released early, cancelled). */
  onSettleAbort?: () => void;
  /** The pulse fired. */
  onPulse?: () => void;
};

/**
 * The settle gesture and the pulse cooldown.
 *
 * Deliberately owns no reveals and no rendering — `update` hands the caller
 * a plain "fire now" signal and the corridor decides what that looks like.
 */
export class SurveyPulse {
  private phase: SurveyPhase = "idle";
  private pressedAtMs = 0;
  private cooldown = 0;

  constructor(private readonly observer: SurveyObserver = {}) {}

  getPhase(): SurveyPhase {
    return this.phase;
  }

  getCooldownSeconds(): number {
    return this.cooldown;
  }

  isReady(): boolean {
    return this.cooldown <= 0;
  }

  /**
   * Fraction of the settle completed, 0..1, for the gathering ring.
   * Zero whenever no settle is in progress.
   *
   * @param nowMs REAL wall-clock ms. Never fictional time.
   */
  getSettleProgress(nowMs: number): number {
    if (this.phase !== "settling") return 0;
    return Math.min(1, (nowMs - this.pressedAtMs) / SETTLE_MS);
  }

  /**
   * The stick went down. A press while the pulse is still cooling does not
   * begin a settle — the player keeps full movement, and no gathering ring
   * appears to promise a pulse that could not fire.
   *
   * @param nowMs REAL wall-clock ms.
   * @param deflection Normalised stick deflection, 0..1.
   */
  pointerDown(nowMs: number, deflection: number) {
    if (this.cooldown > 0 || deflection > SURVEY_DEADZONE) {
      this.phase = "spent";
      return;
    }
    this.phase = "settling";
    this.pressedAtMs = nowMs;
    this.observer.onSettleBegin?.();
  }

  /**
   * Called as the thumb moves and every frame the stick is held.
   *
   * @returns true on the single frame the pulse fires.
   */
  pointerUpdate(nowMs: number, deflection: number): boolean {
    if (this.phase !== "settling") return false;
    if (deflection > SURVEY_DEADZONE) {
      // The player chose to move. Movement always wins over the gesture:
      // a settle that stole a frame of motion would make the stick feel
      // like it was fighting the player.
      this.phase = "spent";
      this.observer.onSettleAbort?.();
      return false;
    }
    if (nowMs - this.pressedAtMs < SETTLE_MS) return false;
    this.phase = "spent";
    this.cooldown = SURVEY_COOLDOWN_SECONDS;
    this.observer.onPulse?.();
    return true;
  }

  /** The stick was released. Never fires a pulse; an early release is an
   * abandoned settle, not a shortened one. */
  pointerUp() {
    if (this.phase === "settling") this.observer.onSettleAbort?.();
    this.phase = "idle";
  }

  /** Pointer cancel / loss of capture / movement disabled mid-touch. */
  cancel() {
    if (this.phase === "settling") this.observer.onSettleAbort?.();
    this.phase = "idle";
  }

  /** @param dt simulation seconds. */
  step(dt: number) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
  }
}

/** Ages reveals and drops the faded ones. @param dt simulation seconds. */
export function stepSurveyReveals(
  reveals: readonly SurveyReveal[],
  dt: number
): SurveyReveal[] {
  const next: SurveyReveal[] = [];
  for (const reveal of reveals) {
    const remaining = reveal.remaining - dt;
    if (remaining > 0) next.push({ ...reveal, remaining });
  }
  return next;
}
