import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIO_CUE_IDS, cueCategory } from "@/game/audio/AudioManager";
import { rookAboard } from "./waywardParty";
import { LINES } from "./waywardLines";

/**
 * The Wayward is fiction. These checks keep it that way, and keep Rook's
 * presence aboard honest: the server read or an explicit preview seam, never a
 * same-device cache, a capability, or a count of real visits.
 */
const HERE = __dirname;
const GOLDLINE = join(HERE, "..");
const CLIENT = join(HERE, "../../../..");
const REPO = join(CLIENT, "..");
const read = (path: string) => readFileSync(path, "utf8");
/** Source with comments removed: docs may name what is forbidden; code may not use it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const waywardSources = readdirSync(HERE)
  .filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
  .map(file => ({ file, source: code(read(join(HERE, file))) }));
const stageMount = code(read(join(GOLDLINE, "stages/WaywardTetheredDeck.tsx")));

describe("Rook aboard the Wayward fails closed", () => {
  it("is absent with no source, and with any server read short of earned-and-true", () => {
    expect(rookAboard(null)).toBe(false);
    expect(rookAboard(undefined)).toBe(false);
    expect(rookAboard({ kind: "server", companionRookOwned: null })).toBe(false);
    expect(rookAboard({ kind: "server", companionRookOwned: { status: "uncertain", value: true } })).toBe(false);
    expect(rookAboard({ kind: "server", companionRookOwned: { status: "unearned", value: false } })).toBe(false);
    expect(rookAboard({ kind: "server", companionRookOwned: { status: "earned", value: false } })).toBe(false);
  });

  it("treats an unexpected server shape as not earned", () => {
    expect(rookAboard({ kind: "server", companionRookOwned: { status: "earned", value: "true" } })).toBe(false);
    expect(rookAboard({ kind: "server", companionRookOwned: { status: "EARNED", value: true } })).toBe(false);
    expect(rookAboard({ kind: "server", companionRookOwned: { value: true } })).toBe(false);
    expect(rookAboard({ kind: "server", companionRookOwned: undefined })).toBe(false);
  });

  it("is aboard on the server's earned read, or through the explicit preview seam", () => {
    expect(rookAboard({ kind: "server", companionRookOwned: { status: "earned", value: true } })).toBe(true);
    expect(rookAboard({ kind: "preview", reason: "wayward-preview-harness" })).toBe(true);
  });

  it("never takes Rook from the same-device party cache, the Colosseum flag, or a capability", () => {
    for (const { file, source } of [...waywardSources, { file: "WaywardTetheredDeck.tsx", source: stageMount }]) {
      for (const forbidden of ["goldlineParty", "isTravelingWith", "useGoldlineParty", "loadParty", "joinParty", "hasColosseumResolved", "capability.rook", "rook.outreach_drafting"]) {
        expect(`${file}: ${source.includes(forbidden) ? forbidden : ""}`).toBe(`${file}: `);
      }
    }
  });

  it("production passes the identity-guarded server read the overworld gate uses", () => {
    const controller = code(read(join(CLIENT, "src/pages/driver/GoldlineDriverController.tsx")));
    const at = controller.indexOf("<WaywardTetheredDeck");
    expect(at).toBeGreaterThan(0);
    const mount = controller.slice(at, controller.indexOf("/>", at));
    expect(mount).toMatch(/kind:\s*"server"/);
    expect(mount).toMatch(/companionRookOwned:\s*progressionForOverworld\?\.companionRookOwned/);
    expect(controller).toMatch(/const progressionForOverworld = progressionForSignedInOperator\(/);
  });

  it("constructs the preview seam only behind the compile-time fixture", () => {
    const productionFiles = [
      join(CLIENT, "src/pages/driver/GoldlineDriverController.tsx"),
      join(CLIENT, "src/pages/Driver.tsx"),
      join(GOLDLINE, "GoldlineOverworld.tsx"),
    ];
    for (const path of productionFiles) {
      const source = code(read(path));
      expect(source).not.toMatch(/kind:\s*"preview"/);
      expect(source).not.toContain("waywardRook");
    }
    // The stage mount reads the preview query only when `fixture` is true.
    expect(stageMount).toMatch(/const params = useMemo\(\(\) => \(fixture \? new URLSearchParams/);
    expect(stageMount).toMatch(/params\?\.get\("waywardRook"\) === "preview"/);
    // And the only fixture mount is the test harness gate in Driver.tsx.
    const driver = read(join(CLIENT, "src/pages/Driver.tsx"));
    expect(driver).toMatch(/const waywardFixture =\s*import\.meta\.env\.VITE_GOLDLINE_TEST_HARNESS === "1"/);
  });
});

describe("The Wayward stays fiction", () => {
  it("imports nothing that can read or write the business", () => {
    for (const { file, source } of waywardSources) {
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]!);
      for (const spec of imports) {
        expect(`${file} -> ${spec}`).not.toMatch(/(@\/lib\/trpc|@shared|server\/|day1TenDoors|colosseumCampaign|Day1FieldMission|salesJournal|goldlineDayPlan)/);
      }
    }
  });

  it("persists nothing itself: no storage, no network", () => {
    for (const { file, source } of waywardSources) {
      for (const forbidden of ["localStorage", "sessionStorage", "fetch(", "XMLHttpRequest", "navigator.sendBeacon"]) {
        expect(`${file}: ${source.includes(forbidden) ? forbidden : ""}`).toBe(`${file}: `);
      }
    }
  });

  it("never plays a victory cue: casting off is a story payoff, not a closed sale", () => {
    const used = new Set<string>();
    for (const { source } of waywardSources) {
      for (const cue of AUDIO_CUE_IDS) if (new RegExp(`["'\`]${cue}["'\`]`).test(source)) used.add(cue);
    }
    expect(used.size).toBeGreaterThan(20);
    for (const cue of used) expect(`${cue}: ${cueCategory(cue as never)}`).not.toMatch(/: victory$/);
  });
});

describe("Rook cannot speak a direct lie", () => {
  it("carries a reason every Rook line is true", () => {
    for (const [id, line] of Object.entries(LINES)) {
      if (line.speaker !== "ROOK") continue;
      expect(`${id}: ${"truth" in line && typeof line.truth === "string" && line.truth.length > 10 ? "ok" : "missing truth note"}`).toBe(`${id}: ok`);
    }
  });

  it("answers the question with nothing untrue, and never names his mechanic on screen", () => {
    expect(LINES["rook-nothing-untrue"].text).toBe("Nothing untrue.");
    const all = [...waywardSources.map(s => s.source)].join("\n");
    expect(all).not.toMatch(/ROOK USED|CONTACT!/);
  });
});

void REPO;
