import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const css = readFileSync(path.join(here, "dayline-world-compositor.css"), "utf8");
const compositor = readFileSync(path.join(here, "DaylineWorldCompositor.tsx"), "utf8");

describe("approved graphic Action Card contracts", () => {
  const approved = css.slice(css.lastIndexOf("APPROVED ACTION-CARD MATERIALS"));
  it("overrides the temporary tan arrows with gold-trim graphic inscriptions", () => {
    expect(approved).toContain("clip-path: none !important");
    expect(approved).toContain("border: 2px solid var(--card-edge) !important");
    expect(approved).toContain(".gdp-v3-action-entry strong");
    expect(approved).toContain("color: #fffdf4 !important");
  });
  it.each(["pickup", "sales", "dropoff", "growth", "marketing"])(
    "uses a distinct object-specific graphic surface for %s", kind => {
      expect(approved).toContain(`.gdp-v3-landmark--${kind} .gdp-v3-action`);
    },
  );
  it("retains every real mission title, time and address as accessible live copy", () => {
    expect(compositor).toContain("{stop.timeLabel}");
    expect(compositor).toContain("{stop.title}");
    expect(compositor).toContain("{stop.address}");
    expect(compositor).toContain("onClick={() => onSelect(stop)}");
    expect(compositor).toContain("key={stop.id}");
    expect(approved).toContain("gdp-v3-landmark--sales .gdp-v3-inscriptions");
  });
});
