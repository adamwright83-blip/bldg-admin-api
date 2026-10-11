import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
const dir = path.dirname(new URL(import.meta.url).pathname);
const tsx = readFileSync(path.join(dir, "DaylineWorldCompositor.tsx"), "utf8");
const css = readFileSync(path.join(dir, "dayline-world-compositor.css"), "utf8");

describe("Day Line cold-load composition", () => {
  it("decodes current stop art and walker before revealing either", () => {
    expect(tsx).toContain("useDaylineArtReady(stops)");
    expect(tsx).toContain("image.decode()");
    expect(tsx).toContain('data-art-ready={artReady}');
    expect(tsx).toContain('gdp-v4-art-scene is-ready');
    expect(tsx).not.toContain('loading={groupIndex > 1 ? "lazy" : "eager"}');
    expect(tsx).toContain('loading="eager"');
  });

  it("keeps the walker sticky when the async day data increases page height", () => {
    expect(tsx).toContain("const avatarTopVh = 55 - 30 * avatar.fraction");
    expect(tsx).not.toContain("bottom: `${avatar.bottomPercent}%`");
    expect(css).toContain(".gdp-v4-avatar {");
    expect(css).toContain("position: sticky !important");
    expect(css).toContain("bottom: auto !important");
  });

  it("attaches the slide to a stone foundation with a foreground mask", () => {
    expect(tsx).toContain('gdp-v4-object-platform');
    expect(tsx).toContain('gdp-v4-object-foreground');
    expect(css).toContain(".gdp-v3-landmark--sales .gdp-v3-landmark-object {");
    expect(css).toContain(".gdp-v3-landmark--sales .gdp-v4-object-platform {");
    expect(css).toContain(".gdp-v3-landmark--sales .gdp-v4-object-foreground {");
  });
});
