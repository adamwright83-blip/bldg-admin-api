/**
 * Query-string harness for the Coastal Market proof. Nothing here reads or
 * writes business state; these only change how the experiment runs.
 *
 *   ?autowalk=1                  spline autopilot drives the real controller end to end
 *   ?shot=overlook|descent|waterfront   fixed gameplay framing for concept comparisons
 *   ?perf=1                      fps / p95 frame ms / draw calls / triangles overlay
 *   ?dpr=1.5                     override the render pixel-ratio cap
 *   ?stride=1.3                  tune the derived brisk walk
 *   ?start=40                    QA: start at this many metres along the route
 *   ?orbit=1.57                  QA: hold the camera this many radians off her back (side views)
 *   ?fx=0                        skip the post stack (bloom, grade) and render straight to the canvas
 *
 * The claude.ai artifact viewer passes no query string, only a bare hash
 * token, so `#perf`, `#autowalk`, `#overlook`, `#descent` and `#waterfront`
 * work there too.
 */
export type ShotId = "overlook" | "descent" | "waterfront";

export type ProofParams = {
  autowalk: boolean;
  shot: ShotId | null;
  perf: boolean;
  dpr: number | null;
  stride: number | null;
  orbit: number | null;
  start: number | null;
  noGate: boolean;
  debug: boolean;
  fx: boolean;
};

const SHOTS: readonly ShotId[] = ["overlook", "descent", "waterfront"];

export function readProofParams(search: string, hash = ""): ProofParams {
  const q = new URLSearchParams(search);
  const token = hash.replace(/^#/, "");
  if (token === "perf" || token === "autowalk") q.set(token, "1");
  if ((SHOTS as readonly string[]).includes(token)) q.set("shot", token);
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
    orbit: num("orbit"),
    start: num("start"),
    noGate: autowalk || shot !== null || q.get("gate") === "0",
    debug: q.get("debug") === "1",
    fx: q.get("fx") !== "0",
  };
}
