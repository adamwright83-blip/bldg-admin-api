import { describe, expect, it } from "vitest";
import { validateJawbreakerArtifact } from "./validation";

const header = [
  "Order ID",
  "Placed",
  "Customer",
  "Customer ID",
  "Address",
  "Paid",
  "Payment Date",
  "Total",
].join(",");

function csv(placed: string) {
  return `${header}\n123,${placed},Jane,77,Los Angeles,yes,2026-09-15 10:05:00,$42.50\n`;
}

describe("Jawbreaker source-range validation", () => {
  it("accepts a row whose CleanCloud placed date is inside the artifact range", () => {
    const result = validateJawbreakerArtifact(
      { csv: csv("2026-09-15 10:00:00"), from: "2026-09-15", to: "2026-09-15" },
      "default"
    );
    expect(result.normalized).toHaveLength(1);
  });

  it("rejects a copied or renamed CSV whose row falls outside the artifact range", () => {
    expect(() =>
      validateJawbreakerArtifact(
        { csv: csv("2026-09-14 10:00:00"), from: "2026-09-15", to: "2026-09-15" },
        "default"
      )
    ).toThrow(/outside artifact range/i);
  });

  it("still accepts a valid BOM-prefixed artifact", () => {
    const result = validateJawbreakerArtifact(
      { csv: `\uFEFF${csv("2026-09-15 10:00:00")}`, from: "2026-09-15", to: "2026-09-15" },
      "default"
    );
    expect(result.normalized[0]?.cleancloudOrderId).toBe("123");
  });
});
