import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  readCommercialWorldFactsForActor,
  readCommercialProgressionFactsForActor,
} from "./commercialWorldReadService";
const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
describe("Commercial-owned world fact boundary", () => {
  it("rejects missing tenant or actor before a database read", async () => {
    for (const reader of [
      readCommercialWorldFactsForActor,
      readCommercialProgressionFactsForActor,
    ]) {
      await expect(reader({ tenantId: "", actorId: "field" })).rejects.toThrow(
        "authority"
      );
      await expect(
        reader({ tenantId: "tenant", actorId: " " })
      ).rejects.toThrow("authority");
    }
  });
  it("supplies domain facts without accepting game state or writing business truth", () => {
    const reader = source("./commercialWorldReadService.ts");
    expect(reader).not.toContain("driverGameWorldNodes");
    expect(reader).not.toMatch(/\.(?:insert|update|delete)\s*\(/);
    const world = source("../driverGameWorld/driverGameWorldService.ts");
    const progression = source(
      "../driverGameWorld/progressionProjectionService.ts"
    );
    expect(world).toContain("readCommercialWorldFactsForActor(input)");
    expect(world).not.toContain("commercialPipelineRecords");
    expect(progression).toContain(
      "readCommercialProgressionFactsForActor(input)"
    );
    for (const table of [
      "commercialVisitOutcomes",
      "commercialFollowUps",
      "commercialPipelineRecords",
    ])
      expect(progression).not.toContain(table);
  });
});
