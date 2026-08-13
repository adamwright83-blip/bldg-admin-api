import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectCorridor,
  projectionCue,
  worldFog,
  type CorridorProjectionInput,
  type ProjectableCorridor,
} from "./corridorProjection";

/**
 * Reads a module with block and line comments stripped, so a guard can assert
 * on what the code DOES rather than on what its documentation discusses.
 */
function codeWithoutComments(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORRIDOR_01: ProjectableCorridor = {
  id: "corridor_01",
  playable: true,
  capabilities: {
    coldCallPortal: true,
    stronghold: true,
    missionSources: ["field", "cold_call", "recovery", "scout"],
  },
};

const CORRIDOR_02_AUTHORING: ProjectableCorridor = {
  id: "corridor_02",
  playable: false,
  capabilities: { coldCallPortal: false, stronghold: false, missionSources: [] },
};

function input(overrides: Partial<CorridorProjectionInput> = {}): CorridorProjectionInput {
  return {
    missionSource: null,
    missionState: null,
    archetype: null,
    corridors: [CORRIDOR_01, CORRIDOR_02_AUTHORING],
    defaultCorridorId: "corridor_01",
    ...overrides,
  };
}

describe("projectCorridor", () => {
  it("is deterministic — the same authoritative state always yields the same corridor", () => {
    const state = input({ missionSource: "field", missionState: "available" });
    const runs = Array.from({ length: 25 }, () => projectCorridor(state));
    const first = JSON.stringify(runs[0]);
    expect(runs.every(run => JSON.stringify(run) === first)).toBe(true);
  });

  it("never selects a corridor that is not playable", () => {
    const projection = projectCorridor(
      input({ missionSource: "field", missionState: "available" })
    );
    expect(projection.corridorId).toBe("corridor_01");
    expect(projection.corridorId).not.toBe("corridor_02");
  });

  it("stays in the entry world and says so when no mission justifies moving", () => {
    const projection = projectCorridor(input());
    expect(projection.corridorId).toBe("corridor_01");
    expect(projection.reason).toBe("ROUTE_OPEN");
    expect(projection.isFallback).toBe(false);
  });

  describe("the player can always answer 'why am I here?'", () => {
    it("reads a captured destination as a Stronghold route", () => {
      const projection = projectCorridor(
        input({ missionSource: "field", missionState: "captured" })
      );
      expect(projection.reason).toBe("STRONGHOLD_ROUTE");
    });

    it("reads contested and recovery states as a recovery path", () => {
      for (const missionState of ["contested", "recovery_available", "recovery_active"] as const) {
        expect(projectCorridor(input({ missionState })).reason).toBe("RECOVERY_PATH");
      }
    });

    it("reads a field-sourced mission as a field signal", () => {
      const projection = projectCorridor(
        input({ missionSource: "field", missionState: "available" })
      );
      expect(projection.reason).toBe("FIELD_SIGNAL");
    });

    it("reads a scout discovery as a new signal", () => {
      const projection = projectCorridor(
        input({ missionSource: "scout", missionState: "available" })
      );
      expect(projection.reason).toBe("NEW_SIGNAL");
    });
  });

  it("honours a corridor's declared capabilities rather than assuming them", () => {
    const strongholdless: ProjectableCorridor = {
      id: "corridor_00",
      playable: true,
      capabilities: { coldCallPortal: false, stronghold: false, missionSources: ["field"] },
    };
    // corridor_00 sorts first alphabetically but cannot host a Stronghold, so
    // a captured destination must not be staged there.
    const projection = projectCorridor(
      input({
        missionState: "captured",
        missionSource: "field",
        corridors: [strongholdless, CORRIDOR_01],
      })
    );
    expect(projection.corridorId).toBe("corridor_01");
  });

  it("falls back honestly, flagging it, when nothing playable exists", () => {
    const projection = projectCorridor(
      input({ missionSource: "field", missionState: "available", corridors: [CORRIDOR_02_AUTHORING] })
    );
    expect(projection.isFallback).toBe(true);
    expect(projection.reason).toBe("ROUTE_OPEN");
  });

  describe("no invented progression", () => {
    it("exposes no level, XP, or unlock vocabulary in actual code", () => {
      // Scans code only: the module's own doc comments deliberately NAME the
      // anti-patterns they rule out, and documenting a prohibition must not
      // read as committing it.
      const code = codeWithoutComments("./corridorProjection.ts");
      expect(code).not.toMatch(/\bLEVEL\s*\d/i);
      expect(code).not.toMatch(/\bunlock/i);
      expect(code).not.toMatch(/\bxp\b/i);
      expect(code).not.toMatch(/experiencePoints/i);
    });

    it("contains no randomness — corridor selection is never a dice roll", () => {
      const code = codeWithoutComments("./corridorProjection.ts");
      expect(code).not.toMatch(/Math\.random/);
      expect(code).not.toMatch(/crypto\.getRandomValues/);
    });

    it("produces cues that state what the world is doing, never an achievement", () => {
      const cues = (
        ["FIELD_SIGNAL", "RECOVERY_PATH", "STRONGHOLD_ROUTE", "NEW_SIGNAL", "ROUTE_OPEN"] as const
      ).map(projectionCue);
      for (const cue of cues) {
        expect(cue).not.toMatch(/level/i);
        expect(cue).not.toMatch(/unlock/i);
      }
      expect(cues).toContain("FIELD SIGNAL");
    });
  });
});

describe("worldFog", () => {
  it("marks an unfinished corridor as unknown, not as hostile or owned", () => {
    const fog = worldFog([CORRIDOR_01, CORRIDOR_02_AUTHORING]);
    expect(fog).toEqual([
      { corridorId: "corridor_01", known: true },
      { corridorId: "corridor_02", known: false },
    ]);
  });

  it("describes fog with no geography, ownership, or competitor vocabulary", () => {
    const source = readFileSync(resolve(__dirname, "./corridorProjection.ts"), "utf8");
    const fogSection = source.slice(source.indexOf("Fog —"));
    expect(fogSection).not.toMatch(/\bcity\b/i);
    expect(fogSection).not.toMatch(/\bneighbou?rhood\b/i);
    // Fog carries no cell-level owner or rival field.
    const fog = worldFog([CORRIDOR_01]);
    expect(fog[0]).not.toHaveProperty("owner");
    expect(fog[0]).not.toHaveProperty("competitor");
    expect(fog[0]).not.toHaveProperty("marketShare");
  });
});
