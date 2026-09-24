import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Spring, wrapAngle } from "./runtime/motion";
import { readProofParams } from "./runtime/params";

/**
 * The Coastal Market proof is an isolated experiment. These checks keep it
 * that way: lazy behind its own route, no business authority, not a corridor,
 * and a route that is actually the 60-90 second walk it claims to be.
 */
const HERE = __dirname;
const CLIENT_SRC = join(HERE, "../../..");
const REPO = join(CLIENT_SRC, "../..");
const read = (path: string) => readFileSync(path, "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const proofSources = walk(HERE)
  .filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
  .map(file => ({ file: relative(HERE, file), source: code(read(file)) }));

describe("the proof is isolated", () => {
  it("is reached only through a lazy import in App.tsx", () => {
    const app = read(join(CLIENT_SRC, "App.tsx"));
    expect(app).toMatch(/lazy\(\s*\(\)\s*=>\s*import\("\.\/pages\/goldline\/coastalMarketProof\/CoastalMarketProofPage"\)\s*\)/);
    expect(app).not.toMatch(/^import .*coastalMarketProof/m);
    const importers = walk(CLIENT_SRC)
      .filter(f => /\.(ts|tsx)$/.test(f) && !f.startsWith(HERE) && !f.endsWith("App.tsx"))
      .filter(f => /coastalMarketProof/.test(read(f)));
    expect(importers).toEqual([]);
  });

  it("imports nothing from the rest of the app", () => {
    const packages = /^(three|three-mesh-bvh|react)$|^three\/examples\/jsm\//;
    for (const { file, source } of proofSources) {
      for (const m of source.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
        const spec = m[1];
        if (packages.test(spec)) continue;
        expect(spec.startsWith(".")).toBe(true);
        const target = join(HERE, file, "..", spec);
        expect(`${file} -> ${spec} stays inside: ${target.startsWith(HERE)}`).toMatch(/true$/);
      }
    }
  });

  it("has no business authority: no API, storage, auth or Goldline state", () => {
    const forbidden = [/\btrpc\b/i, /\/api\//, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /useAuth/, /missionComplete|objectiveComplete|receipt/i, /corridor_0\d/, /Narrator|Claire|Rook\b|CONTACT/];
    for (const { file, source } of proofSources) {
      for (const pattern of forbidden) {
        expect({ file, hit: pattern.test(source) ? String(pattern) : null }).toEqual({ file, hit: null });
      }
    }
    // the only network reads are its own static assets
    for (const { file, source } of proofSources) {
      for (const m of source.matchAll(/fetch\(([^)]*)\)/g)) {
        expect(`${file}: ${m[1]}`).toMatch(/(url|assetBase \+)/);
      }
    }
  });

  it("does not touch the live corridor registry", () => {
    const registry = read(join(CLIENT_SRC, "game/world/corridorRegistry.ts"));
    expect(registry).toContain('export const DEFAULT_CORRIDOR_ID = "corridor_01";');
    expect(registry).not.toMatch(/three|coastal-market-proof|coastalMarketProof/i);
    const c02 = JSON.parse(read(join(REPO, "client/public/assets/goldline/corridor_02/manifest.json")));
    expect(c02.renderer).toBeUndefined();
    expect(c02.stage).toBe("playable");
  });
});

describe("the route is a 60-90 second walk", () => {
  const level = JSON.parse(read(join(REPO, "client/public/assets/goldline/coastal-market-three-proof/level.json")));
  it("is 150-225 m long, overlook high above the water, waterfront at the water", () => {
    expect(level.routeLength).toBeGreaterThan(150);
    expect(level.routeLength).toBeLessThan(225);
    const first = level.route[0];
    const last = level.route[level.route.length - 1];
    expect(first[1]).toBeGreaterThan(25);
    expect(last[1]).toBeLessThan(3);
    // overlook -> descent -> waterfront, in that order
    const kinds: string[] = level.route.map((r: number[]) => level.routeKinds[r[4]]);
    const firstIndex = (k: string) => kinds.indexOf(k);
    expect(firstIndex("terrace")).toBe(0);
    expect(firstIndex("lane")).toBeGreaterThan(firstIndex("stairs"));
    expect(firstIndex("bridge")).toBeGreaterThan(firstIndex("lane"));
    expect(firstIndex("quay")).toBeGreaterThan(firstIndex("bridge"));
    expect(kinds[kinds.length - 1]).toBe("pier");
  });

  it("has boats, a waterfall and a lighthouse to look at", () => {
    expect(level.boats.length).toBeGreaterThanOrEqual(2);
    expect(level.waterfall.top[1]).toBeGreaterThan(level.waterfall.bottom[1] + 20);
    expect(level.lighthouse.lamp[1]).toBeGreaterThan(20);
  });
});

describe("harness parameters", () => {
  it("reads query flags and the artifact viewer's bare hash tokens", () => {
    expect(readProofParams("?autowalk=1").autowalk).toBe(true);
    expect(readProofParams("?autowalk=1").noGate).toBe(true);
    expect(readProofParams("?shot=waterfront").shot).toBe("waterfront");
    expect(readProofParams("?shot=nowhere").shot).toBe(null);
    expect(readProofParams("", "#perf").perf).toBe(true);
    expect(readProofParams("", "#overlook").shot).toBe("overlook");
    expect(readProofParams("", "#perf=1&autowalk=1").autowalk).toBe(false);
    expect(readProofParams("").noGate).toBe(false);
  });
});

describe("motion helpers", () => {
  it("wraps angles into (-pi, pi]", () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 6);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5, 6);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI, 6);
  });

  it("turns the short way round and settles without overshoot", () => {
    const s = new Spring(Math.PI - 0.1);
    let max = -Infinity;
    for (let i = 0; i < 120; i++) {
      s.step(-Math.PI + 0.1, 16, 1 / 60, true);
      max = Math.max(max, Math.abs(wrapAngle(s.value - (-Math.PI + 0.1))));
    }
    expect(Math.abs(wrapAngle(s.value - (-Math.PI + 0.1)))).toBeLessThan(1e-3);
    expect(max).toBeLessThan(0.21);
  });
});
