import { RUINBOUND_TUNING, Shieldbearer } from "@/game/expedition/ruinbound";
import type { OverworldPoint, RuntimeActorState } from "../overworld/types";

const WORLD_SCALE = 700;

export type WaywardGuardianFrame = {
  point: OverworldPoint;
  state: RuntimeActorState;
  struckPlayer: boolean;
  canParry: boolean;
};

/**
 * Thin authored adapter around the production Shieldbearer state machine.
 * Both world axes are normalized into the primitive's authored corridor
 * units, so knockback cannot accidentally move Trailblazer hundreds of
 * combat radii away on Y while X remains scaled.
 */
export class WaywardGuardianEncounter {
  private readonly guardian = new Shieldbearer("wayward-tether-guardian", {
    x: 925 / WORLD_SCALE,
    y: 505 / WORLD_SCALE,
  });

  update(deltaSeconds: number, player: OverworldPoint): WaywardGuardianFrame {
    this.guardian.update(deltaSeconds, {
      x: player.x / WORLD_SCALE,
      y: player.y / WORLD_SCALE,
    });
    const struckPlayer = this.guardian.consumePendingHit() !== null;
    return this.frame(struckPlayer);
  }

  parry(player: OverworldPoint): boolean {
    if (!this.isParryable() || !this.guardian.alive) return false;
    const from = { x: player.x / WORLD_SCALE, y: player.y / WORLD_SCALE };
    this.guardian.onLinehookLatch(from);
    return this.guardian.applyHit(
      RUINBOUND_TUNING.shieldbearer.maxHp,
      from,
      true
    ).defeated;
  }

  current(): WaywardGuardianFrame {
    return this.frame(false);
  }

  private frame(struckPlayer: boolean): WaywardGuardianFrame {
    return {
      point: {
        x: this.guardian.x * WORLD_SCALE,
        y: this.guardian.y * WORLD_SCALE,
      },
      state: !this.guardian.alive
        ? "defeated"
        : this.guardian.isTelegraphing()
          ? "telegraph"
          : this.guardian.exposed
            ? "exposed"
            : "default",
      struckPlayer,
      canParry: this.isParryable() && this.guardian.alive,
    };
  }

  /**
   * The committed slam keeps a tiny reaction grace after the visible wind-up.
   * This avoids rejecting a phone tap delivered on the telegraph→slam frame
   * boundary without making recovery or idle frames parryable.
   */
  private isParryable(): boolean {
    return this.guardian.isTelegraphing() || this.guardian.phase === "slam";
  }
}
