import type { OverworldPoint } from "./types";
export type LinehookPhase = "AIM" | "FIRE" | "HOOK FLIGHT" | "CATCH" | "PLAYER TRAVEL" | "LAND" | "RELEASE";
export function linehookFrame(milliseconds: number, from: OverworldPoint, landing: OverworldPoint, reducedMotion = false) {
  const t = milliseconds * (reducedMotion ? 3 : 1);
  const phase: LinehookPhase = t < 250 ? "AIM" : t < 330 ? "FIRE" : t < 680 ? "HOOK FLIGHT" : t < 800 ? "CATCH" : t < 1800 ? "PLAYER TRAVEL" : t < 2000 ? "LAND" : "RELEASE";
  const progress = Math.max(0, Math.min(1, (t - 800) / 1000));
  const eased = progress * progress * (3 - 2 * progress);
  return { phase, done: t >= 2150, hookProgress: Math.max(0, Math.min(1, (t - 330) / 350)),
    position: { x: from.x + (landing.x - from.x) * eased,
      y: from.y + (landing.y - from.y) * eased - (reducedMotion ? 0 : Math.sin(progress * Math.PI) * 22) } };
}
