import { spawnClockheadProjectiles, stepColosseumProjectiles, sweepHitsPlayer, type ColosseumPoint, type ColosseumProjectile } from "./colosseumCombat";
export type ClockPattern = "aimed" | "fan" | "sweep" | "deadline";
export type ClockDuel = {
  player: ColosseumPoint; hp: number; bossHp: number; phase: 1 | 2 | 3;
  stage: "tell" | "attack" | "exposed" | "won" | "lost";
  pattern: ClockPattern; clock: number; sequence: number; projectiles: ColosseumProjectile[];
  target: ColosseumPoint; dodgeMs: number; dodgeCooldown: number; hurtMs: number;
  freezeMs: number; struck: boolean; cue: number; line: string;
};
export const CLOCK_PHASE_NAMES = { 1: "BORROWED TIME", 2: "OVERTIME", 3: "THE FINAL HOUR" };
export const CLOCK_TELLS: Record<ClockPattern, string> = {
  aimed: "Hold still. I’m putting you on my calendar.",
  fan: "Three appointments. None of them optional.",
  sweep: "Mind the hand. It takes the long way round.",
  deadline: "Your deadline is exactly where you’re standing.",
};
export function createClockDuel(): ClockDuel {
  return { player: { x: 50, y: 80 }, hp: 3, bossHp: 9, phase: 1, stage: "tell", pattern: "aimed",
    clock: 0, sequence: 0, projectiles: [], target: { x: 50, y: 80 }, dodgeMs: 0, dodgeCooldown: 0,
    hurtMs: 0, freezeMs: 0, struck: false, cue: 0, line: CLOCK_TELLS.aimed };
}
function patternFor(phase: 1 | 2 | 3, sequence: number): ClockPattern {
  const patterns: ClockPattern[] = phase === 1 ? ["aimed"] : phase === 2 ? ["fan", "sweep"] : ["deadline", "sweep", "fan"];
  return patterns[sequence % patterns.length]!;
}
export function stepClockDuel(previous: ClockDuel, dt: number, input: { x: number; y: number; dodge?: boolean; strike?: boolean }): ClockDuel {
  if (previous.stage === "won" || previous.stage === "lost") return previous;
  const ms = Math.min(40, Math.max(0, dt));
  const s: ClockDuel = { ...previous, player: { ...previous.player } };
  if (s.freezeMs > 0) { s.freezeMs = Math.max(0, s.freezeMs - ms); return s; }
  s.clock += ms; s.dodgeMs = Math.max(0, s.dodgeMs - ms); s.dodgeCooldown = Math.max(0, s.dodgeCooldown - ms); s.hurtMs = Math.max(0, s.hurtMs - ms);
  if (input.dodge && s.dodgeCooldown === 0) { s.dodgeMs = 320; s.dodgeCooldown = 950; }
  const length = Math.max(1, Math.hypot(input.x, input.y));
  const speed = s.dodgeMs > 0 ? 48 : 28;
  s.player.x = Math.max(5, Math.min(95, s.player.x + input.x / length * speed * ms / 1000));
  s.player.y = Math.max(40, Math.min(88, s.player.y + input.y / length * speed * ms / 1000));
  const damage = () => {
    if (s.dodgeMs > 0 || s.hurtMs > 0) return;
    s.hp--; s.hurtMs = 900; s.freezeMs = 80; s.cue++;
    s.line = s.hp ? "Late again. Try moving before the bell." : "Time’s up. Shall we reschedule?";
    if (s.hp <= 0) { s.stage = "lost"; s.projectiles = []; }
  };
  const stepped = stepColosseumProjectiles(s.projectiles, ms / 1000, s.player, false, s.dodgeMs > 0 || s.hurtMs > 0);
  s.projectiles = stepped.projectiles;
  if (stepped.collisions.length) damage();
  if (s.stage === "lost") return s;
  if (s.stage === "tell" && s.clock >= 950) {
    s.stage = "attack"; s.clock = 0; s.cue++;
    s.target = { ...s.player };
    if (s.pattern === "aimed" || s.pattern === "fan") s.projectiles = [...s.projectiles, ...spawnClockheadProjectiles(s.pattern, s.player, s.sequence)];
  } else if (s.stage === "attack") {
    if (s.pattern === "sweep" && sweepHitsPlayer(s.clock / 1200, s.player)) damage();
    if (s.pattern === "deadline" && s.clock >= 1100 && s.clock < 1220 && Math.hypot(s.player.x - s.target.x, s.player.y - s.target.y) < 14) damage();
    if (s.clock >= 1350 && s.hp > 0) { s.stage = "exposed"; s.clock = 0; s.struck = false; s.line = "A moment. I need to wind myself—"; s.cue++; }
  } else if (s.stage === "exposed") {
    if (input.strike && !s.struck && Math.hypot(s.player.x - 50, s.player.y - 31) <= 38) {
      s.bossHp--; s.struck = true; s.freezeMs = 80; s.cue++;
      s.phase = s.bossHp > 6 ? 1 : s.bossHp > 3 ? 2 : 3;
      s.line = s.bossHp > 0 ? "That was not on the agenda!" : "Impossible. You were supposed to put this off.";
      if (s.bossHp === 0) { s.stage = "won"; s.projectiles = []; return s; }
    }
    if (s.clock >= 1250) { s.sequence++; s.pattern = patternFor(s.phase, s.sequence); s.stage = "tell"; s.clock = 0; s.line = CLOCK_TELLS[s.pattern]; s.cue++; }
  }
  return s;
}
