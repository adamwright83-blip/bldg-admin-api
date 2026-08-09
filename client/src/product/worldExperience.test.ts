import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const world = readFileSync(new URL("./WorldView.tsx", import.meta.url), "utf8");
const hq = readFileSync(new URL("./HqHome.tsx", import.meta.url), "utf8");

describe("HQ tycoon WORLD experience", () => {
  it("makes WORLD primary and enters systems through physical business objects", () => {
    expect(hq).not.toContain("baseTabs");
    expect(hq).not.toContain("cc-hq-tabs");
    expect(world).toContain('href="/product/money"');
    expect(world).toContain('href="/product/grow"');
    expect(world).toContain('"/product/capabilities"');
    expect(world).toContain('"/product/team"');
    expect(world).toContain('href="/product/field"');
  });

  it("physicalizes real projection state without claiming synthetic geography", () => {
    expect(world).toContain("Every property and state is real");
    expect(world).toMatch(/This portfolio layout is not exact\s+geography/);
    expect(world).toContain("data.properties.map");
    expect(world).toContain("data.commercialAssets.map");
    expect(world).toContain("outstandingReceivables.value");
    expect(world).toContain('customerAsset?.health === "at_risk"');
    expect(world).not.toContain("Known records without coordinates");
  });
});
