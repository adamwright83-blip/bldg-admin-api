/**
 * The Linehook — Goldline's signature mechanic (§9–§12).
 *
 * A weighted brass tether, not a teleport and not a rope simulator. §12 is
 * explicit that we are proving FEEL, so this is a small deterministic
 * spring/impulse model: anchor vector, capped pull acceleration, preserved
 * tangential velocity, and a release that hands the player's existing
 * momentum back to them.
 *
 * The one rule that must never be violated:
 *
 *     LATCH -> TENSION -> PULL/SWING -> RELEASE -> MOMENTUM CONTINUES
 *
 * There is no code path that sets the player's position directly and no
 * path that zeroes velocity on detach. `linehook.test.ts` asserts both,
 * because "target -> instant teleport -> zero velocity" is precisely the
 * cheap implementation this mechanic must not become.
 */

export type LinehookPhase = "idle" | "flying" | "latched" | "retracting";

export const LINEHOOK = {
  /** Cable travel toward the anchor. Fast, but visibly a travel. */
  flySpeed: 1450,
  /** Spring constant pulling the player along the cable. */
  pullStiffness: 16,
  /** Caps acceleration so the pull reads as weight, not a snap. */
  maxPullAcceleration: 2100,
  /**
   * Tangential velocity retained per second while latched. Below 1 so a
   * swing decays naturally; high enough that arcs feel preserved.
   */
  tangentialRetention: 0.985,
  /**
   * Winch rate. This — not the spring — is what actually carries the player
   * along the cable, which is why an arc survives the trip.
   */
  reelSpeed: 560,
  /** Latch ends once this close to the anchor — a swing, not a collision. */
  arriveRadius: 34,
  /** Cable slack/stretch envelope, purely for rendering the curve. */
  restLengthFactor: 0.98,
  maxStretch: 1.14,
  /** Release kick along current velocity — the "whoosh" of letting go. */
  releaseBoost: 1.12,
  /** Hard ceiling so a chained swing cannot accumulate absurd speed. */
  maxSpeed: 720,
  hapticMs: 22,
} as const;

export type LinehookAnchor = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Hostile latches control/stagger; architecture latches move the player. */
  readonly pulls: boolean;
};

export type PlayerBody = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export class Linehook {
  phase: LinehookPhase = "idle";
  anchor: LinehookAnchor | null = null;
  /** Cable tip position while flying/retracting — this is what renders. */
  tipX = 0;
  tipY = 0;
  /** 0..1 tension for the renderer's cable brightness and curve flattening. */
  tension = 0;
  private restLength = 0;

  isEngaged(): boolean {
    return this.phase !== "idle";
  }

  /** Fires the cable. Position is never assigned from the anchor here. */
  fire(from: PlayerBody, anchor: LinehookAnchor) {
    this.anchor = anchor;
    this.phase = "flying";
    this.tipX = from.x;
    this.tipY = from.y;
    this.tension = 0;
    this.restLength =
      Math.hypot(anchor.x - from.x, anchor.y - from.y) * LINEHOOK.restLengthFactor;
  }

  /**
   * Releases the tether and RETAINS momentum. Deliberately does not touch
   * `body.x`/`body.y`, and multiplies velocity rather than clearing it.
   */
  release(body: PlayerBody) {
    if (this.phase === "latched") {
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > 0) {
        const boosted = Math.min(speed * LINEHOOK.releaseBoost, LINEHOOK.maxSpeed);
        body.vx = (body.vx / speed) * boosted;
        body.vy = (body.vy / speed) * boosted;
      }
    }
    this.phase = "retracting";
    this.anchor = null;
    this.tension = 0;
  }

  reset() {
    this.phase = "idle";
    this.anchor = null;
    this.tension = 0;
    this.tipX = 0;
    this.tipY = 0;
  }

  /**
   * Integrates one FICTIONAL frame.
   *
   * @returns `latched` on the frame the cable connects, so the caller can
   *   fire the hostile's stagger, the hazard's trigger, audio and haptics
   *   exactly once.
   */
  update(dt: number, body: PlayerBody): { latched: boolean; arrived: boolean } {
    let latched = false;
    let arrived = false;

    switch (this.phase) {
      case "flying": {
        const a = this.anchor;
        if (!a) {
          this.phase = "idle";
          break;
        }
        const dx = a.x - this.tipX;
        const dy = a.y - this.tipY;
        const dist = Math.hypot(dx, dy);
        const step = LINEHOOK.flySpeed * dt;
        if (dist <= step) {
          this.tipX = a.x;
          this.tipY = a.y;
          this.phase = "latched";
          latched = true;
          this.restLength =
            Math.hypot(a.x - body.x, a.y - body.y) * LINEHOOK.restLengthFactor;
          // A control latch (hostile) does no pulling: the Line staggers
          // the enemy and lets go. Only architecture hauls the player.
          if (!a.pulls) {
            this.phase = "retracting";
          }
        } else {
          this.tipX += (dx / dist) * step;
          this.tipY += (dy / dist) * step;
        }
        break;
      }

      case "latched": {
        const a = this.anchor;
        if (!a) {
          this.phase = "retracting";
          break;
        }
        const dx = a.x - body.x;
        const dy = a.y - body.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;

        if (dist <= LINEHOOK.arriveRadius) {
          arrived = true;
          this.release(body);
          break;
        }

        // The cable is a WINCH, not a magnet. Shortening the rest length is
        // what carries Trailblazer along it; the spring below only keeps her
        // on the circle. Pulling her straight at the anchor with a constant
        // near-max force would flatten every arc into a yank.
        this.restLength = Math.max(
          LINEHOOK.arriveRadius,
          this.restLength - LINEHOOK.reelSpeed * dt
        );

        if (dist > this.restLength) {
          // Taut. Spring back onto the cable circle, acceleration-capped so
          // the haul reads as weight rather than a snap.
          const overshoot = dist - this.restLength;
          const accel = Math.min(
            overshoot * LINEHOOK.pullStiffness,
            LINEHOOK.maxPullAcceleration
          );
          body.vx += ux * accel * dt;
          body.vy += uy * accel * dt;

          // Cancel any velocity still pulling AWAY from the anchor, so the
          // cable cannot stretch indefinitely. Motion across the cable is
          // untouched — that surviving tangential component is the swing.
          const radial = body.vx * ux + body.vy * uy;
          if (radial < 0) {
            body.vx -= radial * ux;
            body.vy -= radial * uy;
          }
        }

        // Gentle tangential decay so a swing settles instead of orbiting
        // forever. Applied to the cross-cable component only.
        const radialNow = body.vx * ux + body.vy * uy;
        const tanX = body.vx - radialNow * ux;
        const tanY = body.vy - radialNow * uy;
        const retention = Math.pow(LINEHOOK.tangentialRetention, dt * 60);
        body.vx = radialNow * ux + tanX * retention;
        body.vy = radialNow * uy + tanY * retention;

        const speed = Math.hypot(body.vx, body.vy);
        if (speed > LINEHOOK.maxSpeed) {
          body.vx = (body.vx / speed) * LINEHOOK.maxSpeed;
          body.vy = (body.vy / speed) * LINEHOOK.maxSpeed;
        }

        this.tipX = a.x;
        this.tipY = a.y;
        this.tension = Math.min(
          1,
          dist / Math.max(1, this.restLength * LINEHOOK.maxStretch)
        );
        break;
      }

      case "retracting": {
        const dx = body.x - this.tipX;
        const dy = body.y - this.tipY;
        const dist = Math.hypot(dx, dy);
        const step = LINEHOOK.flySpeed * 1.35 * dt;
        if (dist <= step) {
          this.reset();
        } else {
          this.tipX += (dx / dist) * step;
          this.tipY += (dy / dist) * step;
        }
        break;
      }

      case "idle":
        break;
    }

    return { latched, arrived };
  }
}
