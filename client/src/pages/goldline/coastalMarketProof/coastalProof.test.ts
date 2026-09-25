import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Spring, wrapAngle } from "./runtime/motion";
import { readProofParams } from "./runtime/params";
import { vrmBoneMap } from "./runtime/vrmHero";

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
    const packages = /^(three|three-mesh-bvh|react|@pixiv\/three-vrm)$|^three\/examples\/jsm\//;
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
    const forbidden = [/\btrpc\b/i, /\/api\//, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /useAuth/, /missionComplete|objectiveComplete|receipt/i, /corridor_0\d/, /Narrator|Claire|CONTACT/];
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

describe("Phase 2 Rook reveal", () => {
  it("uses the short dispatch-satchel beat without a direct lie", () => {
    const scene = read(join(HERE, "runtime/phase2World.ts"));
    expect(scene).toContain("TRAILBLAZER: That's not yours.");
    expect(scene).toContain("ROOK: It isn't theirs either.");
    expect(scene).toContain("TRAILBLAZER: Leave it.");
    expect(scene).toContain("ROOK: I am leaving with it.");
    expect(scene).not.toMatch(/ROOK:\s*(Yes|No,? I|I was captured)/);
  });
});

describe("Phase 2 chase set", () => {
  const level = JSON.parse(read(join(REPO, "client/public/assets/goldline/coastal-market-three-proof/level.json")));
  const rigs = level.rigs;

  it("keeps the approved controller constants", () => {
    const src = read(join(HERE, "runtime/controller.ts"));
    expect(src).toContain("export const WALK_SPEED = 5.3;");
    expect(src).toContain("export const SPRINT_SPEED = 8.25;");
    expect(src).toContain("const GRAVITY = 22;");
    expect(src).toContain("const JUMP_VELOCITY = 8.2;");
    expect(src).toContain("const MANTLE_HEIGHT = 1.15;");
  });

  it("uses one tension rule in three places, in chase order, each landing on real floor", () => {
    expect(rigs.crane.csGrab).toBeLessThan(rigs.crane.csLand);
    expect(rigs.crane.csLand).toBeLessThan(rigs.boom.csGrab);
    expect(rigs.boom.csLand).toBeLessThan(rigs.ropeway.csGrab);
    expect(rigs.ropeway.csGrab).toBeLessThan(rigs.ropeway.csLand);
    // RELEASE crosses the raised bridge leaves; the leaves span the floor hole
    const [h0, h1] = rigs.bridge.hole;
    expect(rigs.boom.csGrab).toBeLessThan(h0);
    expect(rigs.boom.csLand).toBeGreaterThan(h1);
    // the hook seats sit a raised hand above the floor at both ends
    for (const rig of [rigs.crane, rigs.boom]) {
      expect(rig.hook1[1] - rig.hook0[1]).toBeGreaterThan(-0.5);
      expect(rig.radius).toBeGreaterThan(3);
    }
    expect(rigs.ropeway.heads).toHaveLength(4);
  });

  it("has mantle obstacles within the climb height and a jumpable gap", () => {
    for (const ob of rigs.obstacles) {
      expect(ob.h).toBeGreaterThan(0.48);
      expect(ob.h).toBeLessThanOrEqual(1.15);
    }
    const [g0, g1] = rigs.holes[0];
    // a jog jump covers ~3.9 m (8.2 m/s up, 22 m/s^2 down, 5.3 m/s along)
    expect(g1 - g0).toBeLessThan(3.0);
  });

  it("moves her with rigs, never by teleport", () => {
    const scene = code(read(join(HERE, "runtime/phase2World.ts")));
    expect(scene).not.toMatch(/placeAt\(/);
    expect(scene).not.toMatch(/teleport/i);
    expect(scene).toMatch(/controller\.hang\(/);
    expect(scene).toMatch(/controller\.release\(/);
  });

  it("stages Rook at his canon size next to her", () => {
    const scene = read(join(HERE, "runtime/phase2World.ts"));
    expect(scene).toContain("const ROOK_RATIO = 0.62;");
    const meta = JSON.parse(read(join(REPO, "client/public/assets/goldline/coastal-market-three-proof/rook-runtime.json")));
    for (const key of ["look", "reach", "lift", "hold", "talk"]) expect(meta.keys).toContain(key);
  });
});

describe("Trailblazer's VRM wears the rig's pose", () => {
  it("maps every rig bone that animates her body onto a distinct VRM humanoid bone", () => {
    const map = vrmBoneMap();
    const vrmNames = map.map(([, v]) => v);
    expect(new Set(vrmNames).size).toBe(vrmNames.length);
    // hips first: the retarget uses the first entry as the root that carries translation
    expect(map[0]).toEqual(["pelvis", "hips"]);
    for (const required of ["spine", "chest", "neck", "head", "leftUpperArm", "rightHand", "leftUpperLeg", "rightFoot", "leftMiddleProximal", "rightMiddleProximal"]) {
      expect(vrmNames).toContain(required);
    }
    // 6 on the spine; per side 8 limb bones, the thumb and four fingers of three joints each
    expect(map.length).toBe(6 + 2 * (8 + 3 + 4 * 3));
  });
});
