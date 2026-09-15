import { describe, expect, it } from "vitest";
import { gumballArtifactFilename, parseGumballArtifactFilename } from "./jawbreakerArtifact";

describe("Jawbreaker artifact naming", () => {
  it("round-trips the durable Gumball inbox identity", () => {
    const identity = {
      storeId: "123",
      from: "2026-09-15",
      to: "2026-09-15",
      artifactId: "123e4567-e89b-42d3-a456-426614174000",
    };
    const name = gumballArtifactFilename(identity);
    expect(name).toBe(
      "gumball-orders_sales-store-123-2026-09-15-2026-09-15-123e4567-e89b-42d3-a456-426614174000.csv"
    );
    expect(parseGumballArtifactFilename(name)).toEqual(identity);
  });

  it("ignores ordinary csv files instead of guessing provenance", () => {
    expect(parseGumballArtifactFilename("CleanCloud Export.csv")).toBeNull();
    expect(parseGumballArtifactFilename("report.crdownload")).toBeNull();
  });
});
