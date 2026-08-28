export function proportionalTowerHeight(value: number, maxValue: number, maxHeight = 240) {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || value <= 0 || maxValue <= 0) return 0;
  return Math.round((value / maxValue) * maxHeight);
}

export function towerComparisonState(firstRevenue: number, secondRevenue: number) {
  const first = Number.isFinite(firstRevenue) && firstRevenue > 0 ? firstRevenue : 0;
  const second = Number.isFinite(secondRevenue) && secondRevenue > 0 ? secondRevenue : 0;
  const delta = Math.abs(first - second);

  if (first === 0 && second === 0) {
    return { kind: "no-revenue" as const, leaderIndex: 0 as const, delta: 0 };
  }

  if (delta < 0.01) {
    return { kind: "even" as const, leaderIndex: 0 as const, delta: 0 };
  }

  return {
    kind: "lead" as const,
    leaderIndex: first > second ? (0 as const) : (1 as const),
    delta,
  };
}
