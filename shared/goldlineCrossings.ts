/** Authored strategic geography, NEVER literal LA hydrology or municipal
 * boundaries. Anchors are geographic truth; adjacency and waterways are fiction. */
export type KingdomAnchor = { id: string; x: number; y: number; evidenceKnown: boolean; guardianCleared: boolean };
export type StrategicCrossing = {
  id: string; from: string; to: string; x: number; y: number;
  riverStart: { x: number; y: number }; riverEnd: { x: number; y: number };
  state: "UNBUILT" | "AVAILABLE" | "OPEN";
  classification: "game_projection";
};
/** Voronoi strategic borders clipped to the atlas. Real anchors define an
 * authored kingdom partition; this is not municipal boundary evidence. */
export function strategicCrossings(input: readonly KingdomAnchor[]): StrategicCrossing[] {
  const nodes = [...input].filter(n => Number.isFinite(n.x) && Number.isFinite(n.y)).sort((a, b) => a.id.localeCompare(b.id));
  const result: StrategicCrossing[] = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance < .001) continue;
    const vx = (b.y - a.y) / distance, vy = (a.x - b.x) / distance;
    let lo = -200, hi = 200;
    const clip = (nx: number, ny: number, bound: number) => {
      const coefficient = nx * vx + ny * vy;
      const residual = bound - nx * mx - ny * my;
      if (Math.abs(coefficient) < 1e-9) { if (residual < -1e-7) hi = lo - 1; }
      else if (coefficient > 0) hi = Math.min(hi, residual / coefficient);
      else lo = Math.max(lo, residual / coefficient);
    };
    clip(1, 0, 100); clip(-1, 0, 0); clip(0, 1, 100); clip(0, -1, 0);
    for (const n of nodes) if (n !== a && n !== b)
      clip(n.x - a.x, n.y - a.y, (n.x * n.x + n.y * n.y - a.x * a.x - a.y * a.y) / 2);
    if (hi - lo < .5) continue;
    const x = mx + vx * (lo + hi) / 2, y = my + vy * (lo + hi) / 2;
    result.push({ id: `${a.id}::${b.id}`, from: a.id, to: b.id, x, y,
      riverStart: { x: mx + vx * lo, y: my + vy * lo }, riverEnd: { x: mx + vx * hi, y: my + vy * hi },
      state: a.evidenceKnown && b.evidenceKnown ? a.guardianCleared && b.guardianCleared ? "OPEN" : "AVAILABLE" : "UNBUILT",
      classification: "game_projection" });
  }
  return result;
}
