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
 * The encounter uses world X / 700 as corridor progress and keeps Y in the
 * primitive's authored lateral units, so its radii and telegraphs retain the
 * same combat meaning without teaching the overworld about combat.
 */
export class WaywardGuardianEncounter {
  private readonly guardian = new Shieldbearer("wayward-tether-guardian", {
    x: 925 / WORLD_SCALE,
    y: 505,
  });

  update(deltaSeconds: number, player: OverworldPoint): WaywardGuardianFrame {
    this.guardian.update(deltaSeconds, { x: player.x / WORLD_SCALE, y: player.y });
    const struckPlayer = this.guardian.consumePendingHit() !== null;
    return this.frame(struckPlayer);
  }

  parry(player: OverworldPoint): boolean {
    if (!this.guardian.isTelegraphing() || !this.guardian.alive) return false;
    const from = { x: player.x / WORLD_SCALE, y: player.y };
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
      point: { x: this.guardian.x * WORLD_SCALE, y: this.guardian.y },
      state: !this.guardian.alive
        ? "defeated"
        : this.guardian.isTelegraphing()
          ? "telegraph"
          : this.guardian.exposed
            ? "exposed"
            : "default",
      struckPlayer,
      canParry: this.guardian.isTelegraphing() && this.guardian.alive,
    };
  }
}
