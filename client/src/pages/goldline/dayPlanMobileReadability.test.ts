import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(__dirname, "goldline-day-plan.css"), "utf8");

describe("Goldline Day Plan mobile readability", () => {
  it("keeps primary cards legible when a phone exposes a desktop viewport", () => {
    expect(css).toContain("(max-device-width: 699px)");
    expect(css).toContain("(pointer: coarse)");
    expect(css).toContain("width: 91vw");
    expect(css).toContain("min-height: 38vw");
    expect(css).toContain("font-size: 4.9vw");
    expect(css).toContain("font-size: 3.7vw");
  });

  it("keeps the world portal secondary to the work cards", () => {
    expect(css).toContain("width: 45vw");
    expect(css).toContain("height: 45vw");
    expect(css).toContain("font-size: 4.5vw");
  });
});
