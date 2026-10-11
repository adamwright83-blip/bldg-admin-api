import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");

describe("illustrated Day Line visual QA contracts", () => {
  it("uses a landmark for a consecutive series rather than one image per day row", () => {
    const compositor = read("DaylineWorldCompositor.tsx");
    expect(compositor).toContain("groupConsecutiveActionSlots(stops)");
    expect(compositor).toContain("groups.map((group, groupIndex)");
    expect(compositor).toContain("group.items.map(({ stop, index })");
    expect(compositor).toContain("onClick={() => onSelect(stop)}");
    expect(compositor).toContain("key={stop.id}");
  });
  it("never labels an unfinished visit as NOW without evidence of arrival", () => {
    const source = read("daylineWorldComposition.ts");
    expect(source).toContain('return "up_next"');
    expect(source).not.toContain('if (stop.id === activeId) return "now"');
    expect(read("DaylineWorldCompositor.tsx")).toContain('state === "up_next"');
  });
  it("does not allow the old baked UI background to replace the clean world", () => {
    const css = read("goldline-driver-ui-polish.css");
    const rule = css.slice(css.lastIndexOf(".gdp-shell.gdp-shell--v2 {"));
    expect(rule).toContain('url("/goldline/dayline-v1/background/world-clean.png") !important');
    expect(rule).toContain("background-size: 100% 100%, 153% auto !important");
    expect(rule).not.toContain("var(--gdp-world)");
  });
  it("preserves the real navigation inside a compact compass while keeping the classic fallback", () => {
    const component = read("GoldlineDayPlan.tsx");
    expect(component).toContain("worldNavigationOpen");
    expect(component).toContain("gdp-v3-nav-toggle");
    expect(component).toContain("GoldlineGameNav");
    expect(component).toContain('new URLSearchParams(window.location.search).get("dayline") !== "classic"');
  });
});
