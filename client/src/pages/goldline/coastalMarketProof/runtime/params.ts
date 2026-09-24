/**
 * Query-string harness for the Coastal Market proof. Nothing here reads or
 * writes business state; these only change how the experiment runs.
 *
 *   ?autowalk=1                  spline autopilot drives the real controller end to end
 *   ?shot=overlook|descent|waterfront   fixed gameplay framing for concept comparisons
 *   ?perf=1                      fps / p95 frame ms / draw calls / triangles overlay
 *   ?dpr=1.5                     override the render pixel-ratio cap
 *   ?stride=1.3&cadence=1.55     tune the derived brisk walk
 */
export type ShotId = "overlook" | "descent" | "waterfront";

export type ProofParams = {
  autowalk: boolean;
  shot: ShotId | null;
  perf: boolean;
  dpr: number | null;
  stride: number | null;
  cadence: number | null;
  noGate: boolean;
  debug: boolean;
};

const SHOTS: readonly ShotId[] = ["overlook", "descent", "waterfront"];

export function readProofParams(search: string): ProofParams {
  const q = new URLSearchParams(search);
  const num = (key: string): number | null => {
    const raw = q.get(key);
    if (raw === null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const shotRaw = q.get("shot");
  const shot = SHOTS.find(id => id === shotRaw) ?? null;
  const autowalk = q.get("autowalk") === "1";
  return {
    autowalk,
    shot,
    perf: q.get("perf") === "1",
    dpr: num("dpr"),
    stride: num("stride"),
    cadence: num("cadence"),
    noGate: autowalk || shot !== null || q.get("gate") === "0",
    debug: q.get("debug") === "1",
  };
}
