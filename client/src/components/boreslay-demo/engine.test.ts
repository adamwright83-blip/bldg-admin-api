import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ARENA_WIDTH, PublicBoreslayEngine, getPresentationMode } from "./engine";

const playing = () => { const e = new PublicBoreslayEngine(); e.start(); return e; };
describe("PublicBoreslayEngine", () => {
  it("keeps movement inside arena bounds", () => { const e=playing(); e.setMovement(-1,0); for(let i=0;i<200;i++)e.update(50); expect(e.state.spark.x).toBe(70); e.state.spark.x=ARENA_WIDTH-75;e.setMovement(1,0);e.update(100);expect(e.state.spark.x).toBe(ARENA_WIDTH-70); });
  it("dash moves Spark and creates invulnerability", () => { const e=playing();e.setMovement(1,0);expect(e.dash()).toBe(true);expect(e.state.spark.x).toBeGreaterThan(260);expect(e.state.spark.invulnerableUntil).toBeGreaterThan(0); });
  it("EXCUSE collision damages once during invulnerability", () => { const e=playing();const s=e.state.spark;e.state.projectiles.push({id:1,kind:"excuse",x:s.x,y:s.y,vx:0,vy:0,radius:32},{id:2,kind:"excuse",x:s.x,y:s.y,vx:0,vy:0,radius:32});e.update(16);expect(e.state.spark.hp).toBe(94); });
  it("Fire Breath damages and can defeat the boss", () => { const e=playing();e.state.boss.x=360;e.state.boss.y=e.state.spark.y-35;e.setAim(360,e.state.spark.y-35);e.state.boss.hp=8;e.fire();e.update(100);expect(e.state.boss.hp).toBe(0);expect(e.state.status).toBe("victory"); });
  it("pause freezes game time and resume continues", () => { const e=playing();e.update(50);e.pause();const t=e.state.time;e.update(5000);expect(e.state.time).toBe(t);e.start();e.update(50);expect(e.state.time).toBe(t+50); });
  it("defeat triggers at zero Spark health", () => { const e=playing();e.state.spark.hp=6;const s=e.state.spark;e.state.projectiles.push({id:1,kind:"excuse",x:s.x,y:s.y,vx:0,vy:0,radius:32});e.update(16);expect(e.state.status).toBe("defeat"); });
  it("public surface has no production data or call imports", () => {
    const source = readFileSync(new URL("./PublicBoreslayDemo.tsx", import.meta.url), "utf8");
    const adapter = readFileSync(new URL("./PublicBoreslayDemoAdapter.ts", import.meta.url), "utf8");
    for (const forbidden of ["@/lib/trpc", "OpsBoardHome", "ComposerPanel", "salesCalls", "twilio", "server/", "drizzle/", "fetch("]) { expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase()); expect(adapter.toLowerCase()).not.toContain(forbidden.toLowerCase()); }
  });
  it("selects a purpose-built portrait presentation", () => { expect(getPresentationMode(390,844)).toBe("portrait"); expect(getPresentationMode(844,390)).toBe("landscape"); expect(getPresentationMode(980,1740,true)).toBe("portrait"); });
  it("restart restores readable actor spawns", () => { const e=playing();e.state.spark.x=900;e.state.boss.hp=0;e.reset();expect(e.state.spark.x).toBe(260);expect(e.state.boss.x-e.state.spark.x).toBeGreaterThan(500);expect(e.state.status).toBe("idle"); });
});
