import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadOverworldCheckpoint,
  overworldCheckpointKey,
  saveOverworldCheckpoint,
} from "./checkpoint";
import { GOLDLINE_OVERWORLD_MAP as map } from "./mapDefinition";
import { isWalkable } from "./navigation";

describe("overworld checkpoint persistence", () => {
  let values: Map<string, string>;
  beforeEach(() => {
    values = new Map();
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Storage;
    (globalThis as { window?: unknown }).window = { localStorage };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("scopes positions by player identity and stores no business state", () => {
    const position = map.spawns.noticeboard!;
    saveOverworldCheckpoint(
      {
        mapVersion: map.version,
        x: position.x,
        y: position.y,
        surfaceId: position.surfaceId,
        facing: "back",
        savedAt: "2026-08-23T00:00:00.000Z",
      },
      "player-one"
    );
    expect(loadOverworldCheckpoint("player-one")?.x).toBe(position.x);
    expect(loadOverworldCheckpoint("player-two")).toBeNull();
    expect(
      Object.keys(JSON.parse(values.get(overworldCheckpointKey("player-one"))!))
    ).toEqual(["mapVersion", "x", "y", "surfaceId", "facing", "savedAt"]);
  });

  it("rejects stale map versions and sanitizes invalid positions", () => {
    values.set(
      overworldCheckpointKey("player"),
      JSON.stringify({
        mapVersion: map.version - 1,
        x: 10,
        y: 10,
        surfaceId: "sky",
        facing: "front",
      })
    );
    expect(loadOverworldCheckpoint("player")).toBeNull();
    values.set(
      overworldCheckpointKey("player"),
      JSON.stringify({
        mapVersion: map.version,
        x: 800,
        y: 800,
        surfaceId: "sky",
        facing: "front",
      })
    );
    const recovered = loadOverworldCheckpoint("player")!;
    expect(isWalkable(map, recovered, 11)).toBe(true);
  });
});
