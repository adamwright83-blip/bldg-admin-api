export type LanternStrike = {
  grade: "PERFECT" | "LIT" | "GLANCING";
  points: number;
  lit: boolean;
};

/** A deterministic cosmetic game. No order, money, or custody input. */
export function lanternPosition(elapsedMs: number, round: number): number {
  const period = Math.max(1000, 1900 - round * 280);
  return (1 - Math.cos((Math.max(0, elapsedMs) / period) * Math.PI * 2)) / 2;
}

export function scoreLanternStrike(position: number): LanternStrike {
  const error = Math.abs(position - 0.5);
  if (error <= 0.055) return { grade: "PERFECT", points: 100, lit: true };
  if (error <= 0.16) return { grade: "LIT", points: 60, lit: true };
  return { grade: "GLANCING", points: 15, lit: false };
}
